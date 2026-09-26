"""Cutover agent (Track 3 owns the real implementation).

G0 stub: replays a fixture run — the rolled-back one when the bad_wave flag
is on for the app, the migrated one otherwise. Never touches the ALB.
"""

from __future__ import annotations

import json

from agents.common import events, fixtures, store
from agents.common.models import AppStatus, CutoverResult, CutoverRun, EventType


def _bad_wave_on(app_id: str) -> bool:
    flag = store.get_flag("bad_wave")
    return bool(flag) and bool(json.loads(flag).get(app_id))


def run(app_id: str, steps=(10, 50, 100), observe_window_s: int = 20) -> CutoverRun:
    base = fixtures.cutover("app-orders" if _bad_wave_on(app_id) else "app-catalog")
    run_ = base.model_copy(update={"app_id": app_id, "steps": list(steps)})
    events.emit("cutover", app_id, EventType.CUTOVER_STARTED, {"steps": list(steps), "stub": True})
    for sample in run_.history:
        events.emit("cutover", app_id, EventType.WEIGHT_SET, {"weight": sample.weight})
        gate = EventType.GATE_PASS if sample.gate == "PASS" else EventType.GATE_FAIL
        events.emit("cutover", app_id, gate, {"weight": sample.weight, "error_rate": sample.error_rate})
    done = EventType.MIGRATED if run_.result == CutoverResult.MIGRATED else EventType.ROLLED_BACK
    events.emit("cutover", app_id, done, run_.rollback.to_dict() if run_.rollback else {})
    store.save_cutover(run_)
    if app_id in {a.app_id for a in store.get_apps()}:
        store.set_status(app_id, AppStatus.MIGRATED if done == EventType.MIGRATED else AppStatus.ROLLED_BACK)
    return run_
