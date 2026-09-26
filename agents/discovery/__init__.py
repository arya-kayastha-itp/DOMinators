"""Discovery agent: scan -> normalize -> rules -> dependencies -> tiering.

Real apps come from Account A (two-hop role, scoped to LEGACY_VPC_IDS);
synthetic apps from data/fleet.json. Both go through the same rules, deps and
tiering. Runs fully with LLM_BACKEND=off.
"""

from __future__ import annotations

import os
import time
from collections import Counter
from typing import Literal

from agents.common import events, store
from agents.common.models import AppRecord, AppStatus, DiscoverySummary, EventType, Source, Tier
from agents.discovery import deps, normalize, rules, scanner, synthetic, tiering

AGENT = "discovery"
BATCH = 50


def scan_real() -> list[AppRecord]:
    from agents.common import aws

    vpc_ids = [v.strip() for v in os.getenv("LEGACY_VPC_IDS", "").split(",") if v.strip()]
    session = aws.legacy()
    raw = scanner.scan(session.client("ec2"), session.client("ssm"), vpc_ids)
    return normalize.normalize(raw)


def discover(real: list[AppRecord], synth: list[AppRecord]):
    """Pure pipeline, no I/O: findings, edges, depends_on, tiers."""
    apps = rules.apply(real) + rules.apply(synth)
    edges = deps.build_edges(apps)
    apps = deps.with_depends_on(apps, edges)
    tiers = tiering.tier_all(apps, edges)
    return apps, edges, tiers


def run(scope: Literal["real", "synthetic", "all"] = "all", *, real_apps: list[AppRecord] | None = None) -> DiscoverySummary:
    """`real_apps` lets tests inject normalized apps instead of scanning AWS."""
    start = time.monotonic()
    events.emit(AGENT, None, EventType.DISCOVERY_STARTED, {"scope": scope})
    try:
        real = (real_apps if real_apps is not None else scan_real()) if scope in ("real", "all") else []
        synth = synthetic.load_fleet() if scope in ("synthetic", "all") else []
        apps, edges, tiers = discover(real, synth)
    except Exception as exc:
        events.emit(AGENT, None, EventType.ERROR, {"stage": "discovery", "error": str(exc)}, level="error")
        raise

    tier_by_id = {t.app_id: t for t in tiers}
    apps = [a.model_copy(update={"status": AppStatus.TIERED}) for a in apps]
    store.upsert_apps(apps)
    store.upsert_tiers(tiers)
    sources = {a.source for a in apps}
    kept = [e for e in store.get_edges() if e.source not in sources]  # a partial scope keeps the other side's edges
    store.replace_edges(kept + edges)

    real_apps_out = [a for a in apps if a.source == Source.REAL]
    events.emit_batch(AGENT, [
        (a.app_id, EventType.APP_DISCOVERED,
         {"findings": [f.value for f in a.findings], "tier": tier_by_id[a.app_id].tier.value})
        for a in real_apps_out
    ])
    synth_ids = [a.app_id for a in apps if a.source == Source.SYNTHETIC]
    events.emit_batch(AGENT, [
        (None, EventType.APP_DISCOVERED, {"source": "synthetic", "app_ids": synth_ids[i:i + BATCH]})
        for i in range(0, len(synth_ids), BATCH)
    ])

    findings = Counter(f for a in apps for f in a.findings)
    tier_counts = Counter(t.tier for t in tiers)
    summary = DiscoverySummary(
        apps_total=len(apps),
        real=len(real_apps_out),
        synthetic=len(synth_ids),
        tiers={t: tier_counts.get(t, 0) for t in Tier},
        findings=dict(sorted(findings.items())),
        edges=len(edges),
        llm_decisions=sum(t.decided_by == "llm" for t in tiers),
        duration_ms=int((time.monotonic() - start) * 1000),
    )
    events.emit(AGENT, None, EventType.DISCOVERY_DONE, summary.to_dict())
    return summary
