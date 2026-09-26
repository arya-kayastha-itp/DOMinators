"""Rebuild fixtures/{apps,tiers,edges,summary,plan}.json from the recorded
Account A responses in fixtures/aws/, using the real Discovery and Planning
code (no AWS access). Run after scripts/record_legacy_fixtures.py.

    python scripts/build_fixtures.py

The clock is pinned so the output is reproducible. Blueprint, cutover,
traffic and event fixtures are hand-curated by their owners and untouched.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents import discovery  # noqa: E402
from agents.common.models import AppStatus, DiscoverySummary, Tier  # noqa: E402
from agents.discovery import normalize, scanner  # noqa: E402
from agents.planning.planner import build_plan  # noqa: E402
from agents.tests.aws_fakes import FakeClient  # noqa: E402

NOW = datetime(2026, 9, 26, tzinfo=timezone.utc)
PLAN_START = date(2026, 9, 28)
OUT = ROOT / "fixtures"


def _vpcs() -> list[str]:
    pages = json.loads((OUT / "aws" / "describe_instances.json").read_text(encoding="utf-8"))
    return sorted({i["VpcId"] for p in pages for r in p["Reservations"] for i in r["Instances"]})


def main() -> None:
    raw = scanner.scan(FakeClient(), FakeClient(), _vpcs())
    apps, edges, tiers = discovery.discover(normalize.normalize(raw, now=NOW), [])
    apps = [a.model_copy(update={"status": AppStatus.TIERED}) for a in apps]
    plan = build_plan(apps, tiers, edges, capacity_per_wave=40, waves_per_week=3, start_date=PLAN_START, now=NOW)
    plan = plan.model_copy(update={"plan_id": "plan-001"})
    counts = Counter(t.tier for t in tiers)
    summary = DiscoverySummary(
        apps_total=len(apps), real=len(apps), synthetic=0,
        tiers={t: counts.get(t, 0) for t in Tier},
        findings=dict(sorted(Counter(f for a in apps for f in a.findings).items())),
        edges=len(edges), llm_decisions=0, duration_ms=4200,
    )

    def dump(name, obj):
        data = [o.to_dict() for o in obj] if isinstance(obj, list) else obj.to_dict()
        (OUT / name).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    dump("apps.json", apps)
    dump("tiers.json", tiers)
    dump("edges.json", edges)
    dump("summary.json", summary)
    dump("plan.json", plan)
    print(f"{len(apps)} apps, {len(edges)} edges, tiers {dict(counts)}, "
          f"wave 0 = {plan.waves[0].app_ids}, parked = {plan.parked}")


if __name__ == "__main__":
    main()
