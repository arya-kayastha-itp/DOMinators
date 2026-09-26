"""Planning agent.

G0 stub: returns the fixture WavePlan through the real store. Replaced by the
graph-based planner in T2-P-1..6.
"""

from __future__ import annotations

from datetime import date

from agents.common import events, fixtures, store
from agents.common.models import AppStatus, EventType, WavePlan


def run(capacity_per_wave: int = 40, waves_per_week: int = 3, start_date: date | None = None) -> WavePlan:
    plan = fixtures.plan().model_copy(update={"capacity_per_wave": capacity_per_wave, "waves_per_week": waves_per_week})
    store.save_plan(plan)
    planned = {a for w in plan.waves for a in w.app_ids}
    for app in store.get_apps():
        if app.app_id in planned:
            store.set_status(app.app_id, AppStatus.PLANNED)
        elif app.app_id in plan.parked:
            store.set_status(app.app_id, AppStatus.PARKED)
    events.emit(
        "planning", None, EventType.PLAN_DONE,
        {"plan_id": plan.plan_id, "waves": len(plan.waves), "parked": len(plan.parked), "stub": True},
    )
    return plan
