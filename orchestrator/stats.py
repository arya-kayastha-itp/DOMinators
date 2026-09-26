"""Every number the console shows comes from here or from the raw store rows —
nothing is estimated or hardcoded. If the store is empty (no discovery yet),
the counts are zero and `discovered` is false, and the UI says so."""

from __future__ import annotations

import json
from collections import Counter

from agents.common import store
from agents.common.models import Source


def _last_event(type_: str) -> dict | None:
    row = store.conn().execute(
        "SELECT id, ts, payload FROM events WHERE type = ? ORDER BY id DESC LIMIT 1", (type_,)
    ).fetchone()
    return {"id": row[0], "ts": row[1], **json.loads(row[2])} if row else None


def summary() -> dict:
    apps = store.get_apps()
    tiers = {t.app_id: t for t in store.get_tiers()}
    edges = store.get_edges()
    plan = store.get_plan()
    real = [a for a in apps if a.source == Source.REAL]
    synth = [a for a in apps if a.source != Source.REAL]

    def tier_counts(group):
        c = Counter(tiers[a.app_id].tier.value for a in group if a.app_id in tiers)
        return {t: c.get(t, 0) for t in ("GOLDEN", "GRAY", "RED")}

    def status_counts(group):
        return dict(Counter(a.status.value for a in group))

    real_ids = {a.app_id for a in real}
    out = {
        "discovered": bool(apps),
        "apps_total": len(apps),
        "real": len(real),
        "synthetic": len(synth),
        "tiers": tier_counts(apps),
        "tiers_real": tier_counts(real),
        "tiers_synthetic": tier_counts(synth),
        "statuses": status_counts(apps),
        "statuses_real": status_counts(real),
        "statuses_synthetic": status_counts(synth),
        "findings": dict(Counter(f.value for a in apps for f in a.findings)),
        "findings_real": dict(Counter(f.value for a in real for f in a.findings)),
        "findings_real_total": sum(len(a.findings) for a in real),
        "finding_codes_seen": len({f for a in apps for f in a.findings}),
        "edges": len(edges),
        "edges_real": sum(1 for e in edges if e.from_ in real_ids and e.to in real_ids),
        "llm_decisions": sum(1 for t in tiers.values() if t.decided_by.value == "llm"),
        "last_discovery": _last_event("DISCOVERY_DONE"),
        "real_apps": [
            {"app_id": a.app_id, "name": a.name, "status": a.status.value,
             "tier": tiers[a.app_id].tier.value if a.app_id in tiers else None,
             "score": tiers[a.app_id].score if a.app_id in tiers else None,
             "findings": len(a.findings), "depends_on": a.depends_on,
             "stateful": a.runtime.stateful}
            for a in real
        ],
        "plan": None,
    }
    if plan:
        out["plan"] = {
            "plan_id": plan.plan_id,
            "generated_at": plan.generated_at.isoformat(),
            "capacity_per_wave": plan.capacity_per_wave,
            "waves_per_week": plan.waves_per_week,
            "waves": len(plan.waves),
            "parked": len(plan.parked),
            "wave0": plan.waves[0].app_ids if plan.waves else [],
            "first_wave_start": plan.waves[0].start.isoformat() if plan.waves else None,
            "projection": plan.projection.to_dict(),
        }
    cut = {}
    for a in real:
        c = store.get_cutover(a.app_id)
        if c:
            cut[a.app_id] = c.to_dict()
    out["cutovers_real"] = cut
    return out
