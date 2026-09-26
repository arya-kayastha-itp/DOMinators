"""The cutover controller (T3-C-5, T3-C-6, T3-C-7): the deterministic state
machine. Claude never runs in here — only `gates.evaluate()` decides
pass/fail; `agents/cutover/explainer.py` writes the sentence afterwards, from
outside this module.

    precheck: tg-target all healthy? -> else ABORT (weights untouched)
    for step in steps:
        set weights (100-step, step); WEIGHT_SET; heartbeat
        wait observe_window (skip settle)
        gate fails -> weights (100,0); GATE_FAIL, ROLLED_BACK; return
        GATE_PASS
    MIGRATED; SIM_DECOMMISSION
    finally: if not MIGRATED -> weights (100,0)

The `finally` above is real: `_guarded()` wraps the whole loop, so a raised
exception, a SIGINT/SIGTERM (main thread only) or a plain `return` on gate
failure all converge on the same rollback call. A hard kill (`kill -9` / a
non-main-thread run) can't be caught by any of that — the store's
`cutover_heartbeat:<app_id>` flag going stale is what the orchestrator's
watchdog uses to reset weights in that case (T3-C-7).
"""

from __future__ import annotations

import atexit
import signal
import threading
import time
from collections.abc import Sequence
from contextlib import contextmanager
from datetime import datetime, timezone

from agents.cutover import gates, weights as weightsmod
from agents.common import events, store
from agents.common.models import CutoverResult, Gate, GateSample, Rollback

HEARTBEAT_INTERVAL_S = 1.0
_CATCHABLE_SIGNALS = (signal.SIGINT, signal.SIGTERM)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Cutover:
    """One run of the controller for one app."""

    def __init__(
        self,
        app_id: str,
        elbv2,
        *,
        steps: Sequence[int] = (10, 50, 100),
        observe_window_s: int = 20,
        settle_s: float = 2.0,
        cfg: gates.GateConfig | None = None,
        assert_managed=None,
        targets_healthy_fn=None,
        sleep=time.sleep,
    ):
        self.app_id = app_id
        self.elbv2 = elbv2
        self.steps = list(steps)
        self.observe_window_s = observe_window_s
        self.settle_s = settle_s
        self.cfg = cfg or gates.GateConfig()
        self._assert_managed = assert_managed
        self._targets_healthy_fn = targets_healthy_fn or (lambda: weightsmod.target_healthy(self.elbv2, self.app_id))
        self._sleep = sleep
        self._migrated = False
        self._heartbeat_stop = threading.Event()

    # -- weight control ---------------------------------------------------

    def _set_weights(self, target_pct: int) -> None:
        kwargs = {} if self._assert_managed is None else {"assert_managed": self._assert_managed}
        weightsmod.set_weights(self.elbv2, self.app_id, target_pct, **kwargs)

    def _rollback(self) -> None:
        """< 2s: one API call back to 100/0. Idempotent, so a signal handler,
        the `finally` below and an explicit gate-fail call can all fire without
        double-booking anything observable."""
        self._set_weights(0)

    # -- heartbeat + crash safety net --------------------------------------

    def _heartbeat_loop(self) -> None:
        while not self._heartbeat_stop.is_set():
            store.set_flag(f"cutover_heartbeat:{self.app_id}", _now().isoformat())
            self._heartbeat_stop.wait(HEARTBEAT_INTERVAL_S)

    @contextmanager
    def _guarded(self):
        heartbeat = threading.Thread(target=self._heartbeat_loop, daemon=True, name=f"heartbeat-{self.app_id}")
        heartbeat.start()

        def _on_signal(signum, frame):
            self._rollback()
            raise SystemExit(1)

        previous: dict[int, object] = {}
        for sig in _CATCHABLE_SIGNALS:
            try:
                previous[sig] = signal.signal(sig, _on_signal)
            except (ValueError, OSError):
                pass  # not the main thread, or not supported on this platform/OS
        atexit.register(self._atexit_rollback)
        try:
            yield
        finally:
            self._heartbeat_stop.set()
            heartbeat.join(timeout=2)
            for sig, handler in previous.items():
                signal.signal(sig, handler)
            atexit.unregister(self._atexit_rollback)
            if not self._migrated:
                self._rollback()

    def _atexit_rollback(self) -> None:
        if not self._migrated:
            self._rollback()

    # -- the loop -----------------------------------------------------------

    def run(self) -> tuple[CutoverResult, list[GateSample], Rollback | None]:
        history: list[GateSample] = []
        if not self._targets_healthy_fn():
            events.emit("cutover", self.app_id, "CUTOVER_ABORTED", {"reason": "tg-target unhealthy"}, level="error")
            return CutoverResult.ABORTED, history, None

        events.emit("cutover", self.app_id, "CUTOVER_STARTED", {"steps": self.steps})
        with self._guarded():
            for step in self.steps:
                self._set_weights(step)
                weight_set_at = _now()
                events.emit("cutover", self.app_id, "WEIGHT_SET", {"weight": step})
                self._sleep(self.observe_window_s)

                samples = store.traffic_window(self.app_id, self.observe_window_s + 5)
                result = gates.evaluate(
                    samples, step, self.cfg,
                    weight_set_at=weight_set_at, settle_s=self.settle_s,
                    targets_healthy=self._targets_healthy_fn(),
                )
                sample = GateSample(
                    weight=step, ts=weight_set_at,
                    error_rate=result.metrics.get("error_rate", 0.0),
                    p95_ms=result.metrics.get("p95_ms", 0.0),
                    target_share=result.metrics.get("target_share", 0.0),
                    gate=Gate.PASS if result.passed else Gate.FAIL,
                )
                history.append(sample)

                if not result.passed:
                    self._rollback()  # explicit, so this happens before any event or return
                    reason = "; ".join(result.reasons)
                    events.emit("cutover", self.app_id, "GATE_FAIL", {"weight": step, "reasons": result.reasons}, level="warn")
                    rollback = Rollback(at_weight=step, reason=reason)
                    events.emit("cutover", self.app_id, "ROLLED_BACK", rollback.to_dict(), level="error")
                    return CutoverResult.ROLLED_BACK, history, rollback

                events.emit("cutover", self.app_id, "GATE_PASS", {"weight": step, **result.metrics})

            self._migrated = True

        events.emit("cutover", self.app_id, "MIGRATED", {})
        events.emit("cutover", self.app_id, "SIM_DECOMMISSION", {"app_id": self.app_id})
        return CutoverResult.MIGRATED, history, None
