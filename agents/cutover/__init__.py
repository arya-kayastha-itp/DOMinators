"""Cutover & Validation agent (Track 3 / A4): shift live traffic through the
edge ALB in steps, gate each one against the `traffic` table, and roll back
deterministically the instant a gate fails (agents/cutover/controller.py).
Claude never decides the rollback; agents/cutover/explainer.py only writes
the sentence afterwards.

Talks to the real ALB (`aws.agent_runner().client("elbv2")`, needs T1-1)
unless `elbv2` is passed explicitly — which is how
`agents/cutover/fake_alb.py`'s `FakeElbClient` plugs in for local runs and
tests, with no other code change.
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from pathlib import Path

import yaml

from agents.cutover import controller, explainer, gates
from agents.common import aws, events, store
from agents.common.models import AppStatus, CutoverResult, CutoverRun, EventType

AGENT = "cutover"
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"

_RESULT_STATUS = {
    CutoverResult.MIGRATED: AppStatus.MIGRATED,
    CutoverResult.ROLLED_BACK: AppStatus.ROLLED_BACK,
}


def load_config() -> dict:
    return yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))


def _gate_config(cfg_raw: dict) -> gates.GateConfig:
    gate_fields = dict(cfg_raw.get("gates", {}))
    gate_fields.setdefault("min_requests", cfg_raw.get("min_requests", 50))
    return gates.GateConfig(**gate_fields)


def _next_run_id() -> str:
    seq = int(store.get_flag("cutover_run_seq") or "0") + 1
    store.set_flag("cutover_run_seq", str(seq))
    return f"cut-{seq:04d}"


def _default_elbv2():
    session = aws.agent_runner() if os.getenv("AGENT_RUNNER_ROLE_ARN") else aws.target()
    return session.client("elbv2")


def run(
    app_id: str,
    steps: Sequence[int] = (10, 50, 100),
    observe_window_s: int = 20,
    *,
    elbv2=None,
    assert_managed=None,
) -> CutoverRun:
    apps = {a.app_id: a for a in store.get_apps()}
    app = apps.get(app_id)
    if app is None:
        events.emit(AGENT, app_id, EventType.ERROR, {"error": "unknown app_id — run discovery first"}, level="error")
        raise KeyError(f"unknown app_id: {app_id}")

    cfg_raw = load_config()
    gate_cfg = _gate_config(cfg_raw)
    settle_s = cfg_raw.get("settle_s", 2)

    previous_status = app.status
    store.set_status(app_id, AppStatus.CUTTING_OVER)

    ctl = controller.Cutover(
        app_id, elbv2 or _default_elbv2(),
        steps=list(steps), observe_window_s=observe_window_s, settle_s=settle_s,
        cfg=gate_cfg, assert_managed=assert_managed,
    )
    result, history, rollback = ctl.run()
    explanation = explainer.explain(app_id, result.value, history, rollback)

    run_id = _next_run_id()
    cutover_run = CutoverRun(
        run_id=run_id, app_id=app_id, steps=list(steps), history=history,
        result=result, rollback=rollback, explanation=explanation,
    )
    store.save_cutover(cutover_run)
    store.set_status(app_id, _RESULT_STATUS.get(result, previous_status))
    return cutover_run
