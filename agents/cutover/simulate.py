"""Synthetic wave simulation (T3-C-9): CutoverRun-shaped events for a whole
wave of synthetic apps, with a small seeded rollback rate, so a wave view
looks like a real batch migration while only the real apps ever touch the
ALB. Deterministic per `app_id` (a seeded PRNG keyed off it), so re-running
the same wave in a rehearsal always tells the same story.

The decision (`_decide`) is pure — no store, no events — so `simulate_wave`
can compute a whole wave in memory and write it in one batch each for
events/cutover rows/status, the same batching Discovery uses for its
1,000-app run. `simulate_one` still writes immediately, for a single ad hoc
call.
"""

from __future__ import annotations

import hashlib
import random
from datetime import datetime, timezone

from agents.common import events, store
from agents.common.models import AppStatus, CutoverResult, CutoverRun, EventType, Gate, GateSample, Rollback

ROLLBACK_RATE = 0.03
STEPS = (10, 50, 100)


def _seed_for(app_id: str) -> int:
    return int(hashlib.sha256(app_id.encode()).hexdigest(), 16) % (2**32)


_SimEvent = tuple[str, EventType, dict, str]  # (app_id, type, payload, level)


def _decide(app_id: str, run_id: str | None = None) -> tuple[CutoverRun, list[_SimEvent]]:
    rng = random.Random(_seed_for(app_id))
    rolls_back = rng.random() < ROLLBACK_RATE
    fail_at = rng.randrange(len(STEPS)) if rolls_back else None
    run_id = run_id or f"sim-{app_id}"

    history: list[GateSample] = []
    ev: list[_SimEvent] = [(app_id, EventType.CUTOVER_STARTED, {"steps": list(STEPS), "sim": True}, "info")]

    for i, step in enumerate(STEPS):
        ev.append((app_id, EventType.WEIGHT_SET, {"weight": step, "sim": True}, "info"))
        fail = fail_at == i
        error_rate = round(rng.uniform(0.05, 0.4), 3) if fail else round(rng.uniform(0.0, 0.01), 4)
        history.append(GateSample(
            weight=step, ts=datetime.now(timezone.utc), error_rate=error_rate,
            p95_ms=round(rng.uniform(80, 250), 1), target_share=round(step / 100, 2),
            gate=Gate.FAIL if fail else Gate.PASS,
        ))

        if fail:
            ev.append((app_id, EventType.GATE_FAIL, {"weight": step, "sim": True}, "warn"))
            rollback = Rollback(at_weight=step, reason=f"error_rate {error_rate:.2f} > 0.02 (simulated)")
            ev.append((app_id, EventType.ROLLED_BACK, rollback.to_dict(), "error"))
            run = CutoverRun(
                run_id=run_id, app_id=app_id, steps=list(STEPS), history=history,
                result=CutoverResult.ROLLED_BACK, rollback=rollback,
                explanation=f"Simulated rollback at {step}%: {rollback.reason}.",
            )
            return run, ev

        ev.append((app_id, EventType.GATE_PASS, {"weight": step, "sim": True}, "info"))

    ev.append((app_id, EventType.MIGRATED, {"sim": True}, "info"))
    ev.append((app_id, EventType.SIM_DECOMMISSION, {"sim": True}, "info"))
    run = CutoverRun(
        run_id=run_id, app_id=app_id, steps=list(STEPS), history=history,
        result=CutoverResult.MIGRATED, rollback=None,
        explanation="All simulated gates passed; traffic followed the weights.",
    )
    return run, ev


def simulate_one(app_id: str, run_id: str | None = None) -> CutoverRun:
    run, ev = _decide(app_id, run_id)
    events.emit_batch_leveled("cutover", ev)
    store.save_cutover(run)
    if app_id in {a.app_id for a in store.get_apps()}:
        status = AppStatus.ROLLED_BACK if run.result == CutoverResult.ROLLED_BACK else AppStatus.MIGRATED
        store.set_status(app_id, status)
    return run


def simulate_wave(app_ids: list[str]) -> list[CutoverRun]:
    decided = [_decide(app_id) for app_id in app_ids]
    runs = [run for run, _ev in decided]

    events.emit_batch_leveled("cutover", [item for _run, ev in decided for item in ev])
    store.save_cutovers(runs)

    existing = {a.app_id: a for a in store.get_apps() if a.app_id in set(app_ids)}
    if existing:
        updated = [
            existing[r.app_id].model_copy(update={
                "status": AppStatus.ROLLED_BACK if r.result == CutoverResult.ROLLED_BACK else AppStatus.MIGRATED
            })
            for r in runs if r.app_id in existing
        ]
        store.upsert_apps(updated)
    return runs
