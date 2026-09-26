"""Planning agent: Discovery's apps, tiers and edges from the store -> WavePlan.
Rule-based and deterministic; works with LLM_BACKEND=off. With an LLM backend,
Claude rewrites the pilot wave's rationale (T2-P-5) — one call, template on
any failure. Wave membership and order never come from the model."""

from __future__ import annotations

import os
from datetime import date

from agents.common import events, store
from agents.common.models import AppStatus, Edge, EventType, Tiering, WavePlan
from agents.planning.planner import build_plan

AGENT = "planning"

RATIONALE_SYSTEM = (
    "You explain a cloud migration wave plan to a judge in two short sentences. "
    "Say why these apps go first and in this order (providers before consumers), and why the "
    "parked apps are held back. Use only the facts given; don't invent apps, dates or numbers."
)


def _llm_pilot_rationale(plan: WavePlan, tiers: list[Tiering], edges: list[Edge]) -> None:
    if os.getenv("LLM_BACKEND", "off") in ("off", "") or not plan.waves or plan.waves[0].name != "Pilot":
        return
    try:
        from agents.common import llm

        pilot = plan.waves[0]
        tier_of = {t.app_id: t for t in tiers}
        real_parked = [a for a in plan.parked if not a.startswith("syn-")]
        facts = {
            "pilot_order": pilot.app_ids,
            "pilot_tiers": {a: tier_of[a].tier.value for a in pilot.app_ids if a in tier_of},
            "dependencies": [f"{e.from_} -> {e.to}" for e in edges if e.from_ in pilot.app_ids],
            # Tier reasons, not risk_summary: the summary also mentions exposure,
            # which the model then misreads as a reason for parking.
            "parked_real_apps": {a: tier_of[a].reasons for a in real_parked if a in tier_of},
        }
        pilot.rationale = llm.complete(RATIONALE_SYSTEM, str(facts), max_tokens=200)
    except Exception as exc:  # noqa: BLE001 - keep the template rationale
        events.emit(AGENT, None, EventType.LLM_FALLBACK, {"reason": f"pilot rationale: {exc}"}, level="warn")


def run(capacity_per_wave: int = 40, waves_per_week: int = 3, start_date: date | None = None) -> WavePlan:
    apps, tiers, edges = store.get_apps(), store.get_tiers(), store.get_edges()
    if not apps:
        events.emit(AGENT, None, EventType.ERROR, {"error": "no apps in the store — run discovery first"}, level="error")
        raise RuntimeError("no apps in the store — run discovery first")
    plan = build_plan(apps, tiers, edges, capacity_per_wave, waves_per_week, start_date)
    _llm_pilot_rationale(plan, tiers, edges)
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
