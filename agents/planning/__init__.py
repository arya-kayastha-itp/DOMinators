"""Planning agent: Discovery's apps, tiers and edges from the store -> WavePlan.
Rule-based and deterministic; works with LLM_BACKEND=off."""

from __future__ import annotations

from datetime import date

from agents.common import events, store
from agents.common.models import AppStatus, EventType, WavePlan
from agents.planning.planner import build_plan

AGENT = "planning"


def run(capacity_per_wave: int = 40, waves_per_week: int = 3, start_date: date | None = None) -> WavePlan:
    apps, tiers, edges = store.get_apps(), store.get_tiers(), store.get_edges()
    if not apps:
        events.emit(AGENT, None, EventType.ERROR, {"error": "no apps in the store — run discovery first"}, level="error")
        raise RuntimeError("no apps in the store — run discovery first")
    plan = build_plan(apps, tiers, edges, capacity_per_wave, waves_per_week, start_date)
    store.save_plan(plan)

    planned = {a for w in plan.waves for a in w.app_ids}
    parked = set(plan.parked)
    for app in apps:
        # Only move apps that haven't gone further down the lifecycle already.
        if app.status in (AppStatus.DISCOVERED, AppStatus.TIERED, AppStatus.PLANNED, AppStatus.PARKED):
            if app.app_id in planned:
                store.set_status(app.app_id, AppStatus.PLANNED)
            elif app.app_id in parked:
                store.set_status(app.app_id, AppStatus.PARKED)

    events.emit(AGENT, None, EventType.PLAN_DONE, {
        "plan_id": plan.plan_id,
        "waves": len(plan.waves),
        "parked": len(plan.parked),
        "projected_finish": plan.projection.projected_finish.isoformat() if plan.projection.projected_finish else None,
        "meets_target_2027": plan.projection.meets_target_2027,
    })
    return plan
