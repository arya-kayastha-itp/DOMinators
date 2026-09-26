import time
from datetime import datetime, timedelta, timezone

import pytest

from agents import cutover
from agents.common import events, store
from agents.common.models import (
    AppRecord, AppStatus, EventType, ServedBy, Source, TrafficSample,
)
from agents.cutover import controller, explainer, fake_alb, gates, simulate, traffic, weights

APP = "app-catalog"


def _sample(app_id, status, latency_ms, served_by, ts=None):
    return TrafficSample(ts=ts or datetime.now(timezone.utc), app_id=app_id, status=status,
                          latency_ms=latency_ms, served_by=served_by)


# ---------------------------------------------------------------- gates (pure)


def test_a_clean_window_passes():
    now = datetime.now(timezone.utc)
    samples = [_sample(APP, 200, 50, ServedBy.TARGET, ts=now) for _ in range(60)]
    result = gates.evaluate(samples, 100, gates.GateConfig())
    assert result.passed and result.metrics["target_share"] == 1.0


def test_high_error_rate_fails():
    now = datetime.now(timezone.utc)
    samples = [_sample(APP, 500 if i < 10 else 200, 50, ServedBy.TARGET, ts=now) for i in range(60)]
    result = gates.evaluate(samples, 100, gates.GateConfig())
    assert not result.passed and any("error_rate" in r for r in result.reasons)


def test_high_latency_fails():
    now = datetime.now(timezone.utc)
    samples = [_sample(APP, 200, 2000, ServedBy.TARGET, ts=now) for _ in range(60)]
    result = gates.evaluate(samples, 100, gates.GateConfig())
    assert not result.passed and any("p95_ms" in r for r in result.reasons)


def test_target_share_below_expected_fails():
    now = datetime.now(timezone.utc)
    samples = [_sample(APP, 200, 50, ServedBy.LEGACY, ts=now) for _ in range(60)]
    result = gates.evaluate(samples, 50, gates.GateConfig())  # expected 50%, got 0%
    assert not result.passed and any("target_share" in r for r in result.reasons)


def test_unhealthy_targets_fail_even_with_clean_traffic():
    now = datetime.now(timezone.utc)
    samples = [_sample(APP, 200, 50, ServedBy.TARGET, ts=now) for _ in range(60)]
    result = gates.evaluate(samples, 100, gates.GateConfig(), targets_healthy=False)
    assert not result.passed and any("unhealthy" in r for r in result.reasons)


def test_too_few_requests_fails():
    now = datetime.now(timezone.utc)
    samples = [_sample(APP, 200, 50, ServedBy.TARGET, ts=now) for _ in range(5)]
    result = gates.evaluate(samples, 100, gates.GateConfig())
    assert not result.passed and any("requests observed" in r for r in result.reasons)


def test_settle_window_is_excluded():
    weight_set_at = datetime.now(timezone.utc)
    stale = [_sample(APP, 500, 50, ServedBy.TARGET, ts=weight_set_at)] * 60  # all errors, but before settle
    fresh = [_sample(APP, 200, 50, ServedBy.TARGET, ts=weight_set_at + timedelta(seconds=3))] * 60
    result = gates.evaluate(stale + fresh, 100, gates.GateConfig(), weight_set_at=weight_set_at, settle_s=2)
    assert result.passed and result.metrics["requests"] == 60  # only the fresh half counted


# ---------------------------------------------------------------- weights (fake ALB)


@pytest.fixture
def alb():
    a = fake_alb.FakeAlb(APP)
    try:
        yield a
    finally:
        a.close()


@pytest.fixture
def patched_outputs(alb, monkeypatch):
    import agents.common.aws as awsmod
    outputs = alb.target_outputs()
    monkeypatch.setattr(awsmod, "target_outputs", lambda: outputs)
    return outputs


def test_set_and_get_weights_round_trip(alb, patched_outputs):
    weights.set_weights(alb.elbv2, APP, 30, assert_managed=lambda arn, session=None: None)
    assert weights.get_weights(alb.elbv2, APP) == {"legacy": 70, "target": 30}


def test_target_healthy_reflects_fake_health(alb, patched_outputs):
    assert weights.target_healthy(alb.elbv2, APP)
    alb.elbv2.set_health(alb.target_arn, "unhealthy")
    assert not weights.target_healthy(alb.elbv2, APP)


def test_set_weights_rejects_out_of_range(alb, patched_outputs):
    with pytest.raises(ValueError):
        weights.set_weights(alb.elbv2, APP, 150, assert_managed=lambda arn, session=None: None)


# ---------------------------------------------------------------- controller (fake ALB, real HTTP)


@pytest.fixture
def running_traffic(alb, patched_outputs):
    gen = traffic.TrafficGenerator(APP, alb.base_url(), "/", rate_per_s=60).start()
    try:
        yield gen
    finally:
        gen.stop()


def test_clean_cutover_migrates_and_follows_weights(alb, patched_outputs, running_traffic):
    ctl = controller.Cutover(APP, alb.elbv2, steps=[10, 100], observe_window_s=6, settle_s=1,
                              assert_managed=lambda arn, session=None: None)
    result, history, rollback = ctl.run()
    assert result.value == "MIGRATED" and rollback is None
    assert [h.gate.value for h in history] == ["PASS", "PASS"]
    assert alb._state.weights == {"legacy": 0, "target": 100}


def test_bad_target_rolls_back_within_one_window(monkeypatch):
    # A separate FakeAlb (not the `alb` fixture) with a broken target:
    # REQUIRE_UPSTREAM=1, no UPSTREAM_URL — the real bad-wave shape.
    bad = fake_alb.FakeAlb(APP, bad_target=True)
    try:
        import agents.common.aws as awsmod
        monkeypatch.setattr(awsmod, "target_outputs", lambda: bad.target_outputs())
        gen = traffic.TrafficGenerator(APP, bad.base_url(), "/", rate_per_s=60).start()
        try:
            ctl = controller.Cutover(APP, bad.elbv2, steps=[10, 50, 100], observe_window_s=6, settle_s=1,
                                      assert_managed=lambda arn, session=None: None)
            start = time.monotonic()
            result, history, rollback = ctl.run()
            elapsed = time.monotonic() - start
        finally:
            gen.stop()
        assert result.value == "ROLLED_BACK" and rollback is not None and rollback.at_weight == 10
        assert bad._state.weights == {"legacy": 100, "target": 0}
        assert elapsed < 10  # one 5s observe window, not three
    finally:
        bad.close()


def test_precheck_aborts_without_touching_weights(alb, patched_outputs):
    alb.elbv2.set_health(alb.target_arn, "unhealthy")
    ctl = controller.Cutover(APP, alb.elbv2, assert_managed=lambda arn, session=None: None)
    result, history, rollback = ctl.run()
    assert result.value == "ABORTED" and history == [] and rollback is None
    assert alb._state.weights == {"legacy": 100, "target": 0}


def test_a_crash_mid_cutover_still_resets_weights_to_100_0(alb, patched_outputs):
    def boom(_seconds):
        raise RuntimeError("simulated crash")

    ctl = controller.Cutover(APP, alb.elbv2, steps=[10, 50, 100], assert_managed=lambda arn, session=None: None, sleep=boom)
    with pytest.raises(RuntimeError):
        ctl.run()
    assert alb._state.weights == {"legacy": 100, "target": 0}


def test_rollback_is_idempotent(alb, patched_outputs):
    ctl = controller.Cutover(APP, alb.elbv2, assert_managed=lambda arn, session=None: None)
    ctl._rollback()
    ctl._rollback()
    assert alb._state.weights == {"legacy": 100, "target": 0}


# ---------------------------------------------------------------- explainer


def test_explainer_template_falls_back_without_llm(monkeypatch):
    monkeypatch.delenv("LLM_BACKEND", raising=False)
    text = explainer.explain(APP, "MIGRATED", [], None)
    assert "Migrated" in text or "gates passed" in text


# ---------------------------------------------------------------- run() end to end


@pytest.fixture(autouse=True)
def _store_app():
    store.upsert_apps([AppRecord(app_id=APP, source=Source.REAL, name=APP, status=AppStatus.PROVISIONED)])
    yield


def test_run_persists_a_cutover_run_and_sets_status(alb, patched_outputs, running_traffic):
    result = cutover.run(APP, steps=(10, 100), observe_window_s=6, elbv2=alb.elbv2,
                          assert_managed=lambda arn, session=None: None)
    assert result.result.value == "MIGRATED"
    assert store.get_cutover(APP) == result
    assert {a.app_id: a.status for a in store.get_apps()}[APP] == AppStatus.MIGRATED
    types = [e.type for e in events.events_since(0)]
    assert types[0] == EventType.CUTOVER_STARTED and types[-1] == EventType.SIM_DECOMMISSION


def test_run_unknown_app_errors_loudly():
    with pytest.raises(KeyError):
        cutover.run("app-does-not-exist")
    assert events.events_since(0)[-1].type == EventType.ERROR


def test_run_ids_increment(alb, patched_outputs, running_traffic):
    alb.elbv2.set_health(alb.target_arn, "unhealthy")  # cheap way to get a fast ABORTED result twice
    r1 = cutover.run(APP, elbv2=alb.elbv2, assert_managed=lambda arn, session=None: None)
    r2 = cutover.run(APP, elbv2=alb.elbv2, assert_managed=lambda arn, session=None: None)
    assert r1.run_id == "cut-0001" and r2.run_id == "cut-0002"


# ---------------------------------------------------------------- synthetic wave simulation


def test_simulated_wave_has_the_expected_rollback_rate():
    app_ids = [f"syn-{i:05d}" for i in range(1000)]
    runs = simulate.simulate_wave(app_ids)
    rolled_back = sum(r.result.value == "ROLLED_BACK" for r in runs)
    assert abs(rolled_back / len(runs) - simulate.ROLLBACK_RATE) < 0.02


def test_simulated_run_is_deterministic_per_app_id():
    def _stable(run):
        return run.result, [(h.weight, h.error_rate, h.p95_ms, h.target_share, h.gate) for h in run.history]

    r1 = simulate.simulate_one("syn-00042")
    r2 = simulate.simulate_one("syn-00042")
    assert _stable(r1) == _stable(r2)  # same numbers every time; only `ts` (wall clock) differs
