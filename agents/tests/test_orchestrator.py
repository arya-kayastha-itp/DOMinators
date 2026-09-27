"""Orchestrator API (T4-O-10): runs are async with per-app locks, lifecycle
checks refuse out-of-order runs, waves move synthetic apps, the watchdog
resets a dead cutover, and every event gets a summary. No AWS: real-app
paths are exercised with fakes."""

import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from agents.common import events, fixtures, store
from agents.common.models import AppStatus, Event, Source
from orchestrator import copilot, runs
from orchestrator.summaries import summarize, to_console


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ORCH_WATCHDOG", "0")
    from orchestrator.main import app
    with TestClient(app) as c:
        yield c


def wait_idle(timeout=60):
    deadline = time.monotonic() + timeout
    while runs.running() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not runs.running(), f"still running: {runs.running()}"


def discover_synthetic(client):
    r = client.post("/runs/discovery", json={"scope": "synthetic"})
    assert r.status_code == 202 and r.json()["status"] == "STARTED"
    wait_idle()


def test_health_and_empty_summary(client):
    h = client.get("/healthz").json()
    assert h["ok"] and h["llm_backend"] == "off"
    s = client.get("/summary").json()
    assert s["discovered"] is False and s["apps_total"] == 0 and s["plan"] is None


def test_discovery_then_planning_are_real_background_runs(client):
    discover_synthetic(client)
    s = client.get("/summary").json()
    assert s["apps_total"] == 1000 and s["synthetic"] == 1000 and s["real"] == 0
    assert sum(s["tiers"].values()) == 1000
    fleet = client.get("/fleet").json()
    assert len(fleet) == 1000 and {"tier", "score", "tiering"} <= fleet[0].keys()

    assert client.post("/runs/planning", json={"capacity_per_wave": 40, "waves_per_week": 3}).status_code == 202
    wait_idle()
    plan = client.get("/plan").json()
    assert plan and plan["capacity_per_wave"] == 40
    assert client.get("/summary").json()["plan"]["waves"] == len(plan["waves"])
    preview = client.get("/plan/preview?capacity_per_wave=8&waves_per_week=3").json()
    assert len(preview["waves"]) > len(plan["waves"])      # smaller waves -> more of them
    assert client.get("/plan").json()["plan_id"] == plan["plan_id"]  # preview is never saved


def test_events_carry_server_side_summaries(client):
    discover_synthetic(client)
    evs = client.get("/events/recent?limit=50").json()["events"]
    done = [e for e in evs if e["type"] == "DISCOVERY_DONE"]
    assert done and done[0]["level"] == "success" and "1000 apps" in done[0]["summary"]
    assert all(e["summary"] for e in evs)


def test_lifecycle_refusals(client):
    discover_synthetic(client)
    parked = next(a for a in client.get("/fleet").json() if a["tier"] == "RED")["app_id"]
    r = client.post(f"/runs/blueprint/{parked}")
    assert r.status_code == 409 and "TIERED" in r.json()["detail"]  # no plan yet
    client.post("/runs/planning", json={})
    wait_idle()
    r = client.post(f"/runs/blueprint/{parked}")
    assert r.status_code == 409 and "parked" in r.json()["detail"]
    assert client.post("/runs/cutover/syn-00001").status_code == 409
    ok = next(a for a in client.get("/fleet").json() if a["tier"] == "GOLDEN")["app_id"]
    r = client.post(f"/runs/blueprint/{ok}?apply=true")
    assert r.status_code == 409 and "dry runs only" in r.json()["detail"]
    assert client.post("/runs/wave/999").status_code == 409


def test_a_second_run_on_a_held_key_is_busy(client):
    gate = threading.Event()
    runs.submit("blueprint", ["app:x"], gate.wait, 5)
    try:
        with pytest.raises(runs.Busy):
            runs.submit("cutover", ["app:x"], lambda: None)
        assert "blueprint:x" in runs.running()
        assert client.post("/runs/discovery", json={}).status_code == 409  # never underneath a run
    finally:
        gate.set()
    wait_idle()


def test_synthetic_wave_blueprints_and_simulates_every_app(client):
    discover_synthetic(client)
    client.post("/runs/planning", json={})
    wait_idle()
    wave1 = client.get("/plan").json()["waves"][1]["app_ids"]
    assert client.post("/runs/wave/1").status_code == 202
    wait_idle()
    st = client.get("/statuses").json()
    assert all(st[a] in ("MIGRATED", "ROLLED_BACK") for a in wave1)
    types = {e["type"] for e in client.get("/events/recent?limit=5000").json()["events"]}
    assert {"BLUEPRINT_DRY_RUN", "MIGRATED"} <= types


def test_capabilities_know_how_each_runtime_marks_its_side(monkeypatch):
    monkeypatch.setattr(runs.aws, "target_outputs", lambda: {
        "app_routes": {"app-catalog": {"runtime": "demo-server", "path_prefix": "/catalog"},
                       "app-juice-shop": {"runtime": "juice-shop", "path_prefix": "", "listener_port": 3000},
                       "app-mystery": {"runtime": "something-else", "path_prefix": "/m"}},
        "listener_rule_arns": {"app-catalog": "arn:c", "app-juice-shop": "arn:j", "app-mystery": "arn:m"},
    })
    caps = runs.capabilities()
    assert caps["app-catalog"]["cutover"] and caps["app-catalog"]["marker"] == "body"
    assert caps["app-juice-shop"]["cutover"] and caps["app-juice-shop"]["marker"] == "header"
    assert caps["app-mystery"]["provision"] and not caps["app-mystery"]["cutover"]
    assert "which side" in caps["app-mystery"]["reason"]


def test_served_by_reads_the_header_body_or_infers_legacy():
    from agents.cutover.traffic import _served_by
    from agents.common.models import ServedBy
    assert _served_by(b"<html>", "target", 200) == ServedBy.TARGET          # nginx marker
    assert _served_by(b"<html>", "target", 502) == ServedBy.TARGET          # marked errors count against target
    assert _served_by(b'{"served_by": "legacy"}') == ServedBy.LEGACY       # demo server body
    assert _served_by(b"<html>", None, 200) == ServedBy.UNKNOWN            # no inference unless asked
    assert _served_by(b"<html>", None, 200, unmarked_is_legacy=True) == ServedBy.LEGACY
    assert _served_by(b"<html>", None, 500, unmarked_is_legacy=True) == ServedBy.UNKNOWN  # unmarked error: can't say


def test_retry_allows_re_applying_a_provisioned_app():
    app = next(a for a in fixtures.apps() if a.app_id == "app-catalog")
    store.upsert_apps([app.model_copy(update={"status": AppStatus.PROVISIONED})])
    runs.check_retry("app-catalog")
    store.set_status("app-catalog", AppStatus.PLANNED)
    with pytest.raises(runs.Rejected):
        runs.check_retry("app-catalog")


def test_watchdog_rolls_back_a_cutover_whose_heartbeat_died(monkeypatch):
    app = next(a for a in fixtures.apps() if a.app_id == "app-catalog")
    store.upsert_apps([app.model_copy(update={"status": AppStatus.CUTTING_OVER})])
    store.set_flag("cutover_heartbeat:app-catalog", (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat())
    calls = []
    monkeypatch.setattr(runs, "elbv2", lambda: "fake")
    monkeypatch.setattr(runs.weights, "set_weights", lambda client, app_id, pct: calls.append((app_id, pct)))
    runs.watchdog_tick()
    assert calls == [("app-catalog", 0)]
    assert {a.app_id: a.status for a in store.get_apps()}["app-catalog"] == AppStatus.ROLLED_BACK
    assert any(e.type.value == "ROLLED_BACK" and "watchdog" in e.payload["reason"] for e in events.events_since(0))


def test_watchdog_leaves_a_live_cutover_alone(monkeypatch):
    app = next(a for a in fixtures.apps() if a.app_id == "app-catalog")
    store.upsert_apps([app.model_copy(update={"status": AppStatus.CUTTING_OVER})])
    store.set_flag("cutover_heartbeat:app-catalog", datetime.now(timezone.utc).isoformat())
    monkeypatch.setattr(runs.weights, "set_weights", lambda *a, **k: pytest.fail("must not touch weights"))
    runs.watchdog_tick()
    assert {a.app_id: a.status for a in store.get_apps()}["app-catalog"] == AppStatus.CUTTING_OVER


def test_reset_restores_weights_and_clears_the_store(client, monkeypatch):
    discover_synthetic(client)
    set_calls = []
    monkeypatch.setattr(runs.aws, "target_outputs", lambda: {"listener_rule_arns": {"app-catalog": "a", "app-orders": "b"}})
    monkeypatch.setattr(runs, "elbv2", lambda: "fake")
    monkeypatch.setattr(runs.weights, "set_weights", lambda client, app_id, pct: set_calls.append((app_id, pct)))
    assert client.post("/demo/reset").status_code == 202
    wait_idle()
    assert sorted(set_calls) == [("app-catalog", 0), ("app-orders", 0)]
    assert client.get("/summary").json()["apps_total"] == 0
    assert any(e["payload"].get("reset") for e in client.get("/events/recent").json()["events"])


def test_bad_wave_flag_round_trips(client):
    assert client.post("/demo/bad-wave", json={"app_id": "app-orders", "enabled": True}).json()["bad_wave"]["app-orders"]
    assert client.get("/demo/state").json()["bad_wave"] == {"app-orders": True}
    client.post("/demo/bad-wave", json={"app_id": "app-orders", "enabled": False})
    assert client.get("/demo/state").json()["bad_wave"] == {}


def test_traffic_is_bucketed_per_second(client):
    from agents.common.models import TrafficSample
    now = datetime.now(timezone.utc).replace(microsecond=0)
    store.insert_traffic([
        TrafficSample(ts=now, app_id="app-catalog", status=200, latency_ms=100, served_by="target"),
        TrafficSample(ts=now + timedelta(milliseconds=300), app_id="app-catalog", status=500, latency_ms=300, served_by="legacy"),
        TrafficSample(ts=now + timedelta(seconds=1), app_id="app-catalog", status=200, latency_ms=50, served_by="target"),
    ])
    b = client.get("/traffic/app-catalog?seconds=60").json()
    assert [x["n"] for x in b] == [2, 1]
    assert b[0]["target"] == 1 and b[0]["legacy"] == 1 and b[0]["errors"] == 1


def test_copilot_falls_back_to_facts_when_the_llm_is_off(client):
    discover_synthetic(client)
    r = client.post("/copilot", json={"question": "How many apps are there?"}).json()
    assert r["fallback"] is True and "1000 apps discovered" in r["answer"]


def test_copilot_facts_include_the_app_asked_about():
    store.upsert_apps(fixtures.apps())
    store.upsert_tiers(fixtures.tiers())
    facts = copilot.facts_for("what about app-orders and syn-99999?")
    assert facts["apps_asked_about"]["app-orders"]["record"]["app_id"] == "app-orders"
    assert facts["apps_asked_about"]["syn-99999"] == "not found"


def test_summaries_read_only_the_payload():
    e = Event(id=1, ts=datetime.now(timezone.utc), agent="cutover", app_id="app-orders", type="GATE_FAIL",
              payload={"weight": 10, "reasons": ["error_rate 0.38 > 0.02"]})
    assert summarize(e) == "app-orders gate FAILED at 10% · error_rate 0.38 > 0.02"
    ok = Event(id=2, ts=datetime.now(timezone.utc), agent="cutover", app_id="app-orders", type="MIGRATED", payload={})
    assert to_console(ok)["level"] == "success"
    sim = Event(id=3, ts=datetime.now(timezone.utc), agent="cutover", app_id="syn-1", type="MIGRATED", payload={"sim": True})
    assert "(simulated)" in summarize(sim)


def test_real_cutover_runs_behind_a_traffic_generator(monkeypatch):
    """do_cutover wraps cutover.run in a TrafficGenerator against the app's ALB path."""
    store.upsert_apps([a.model_copy(update={"status": AppStatus.PROVISIONED}) for a in fixtures.apps()
                       if a.source == Source.REAL and a.app_id == "app-catalog"])
    seen = {}

    class FakeGen:
        def __init__(self, app_id, base, path, unmarked_is_legacy=False):
            seen.update(app_id=app_id, url=base + path)

        def __enter__(self):
            seen["started"] = True
            return self

        def __exit__(self, *a):
            seen["stopped"] = True

    monkeypatch.setattr(runs, "TrafficGenerator", FakeGen)
    monkeypatch.setattr(runs, "traffic_url", lambda app_id: ("http://alb", "/catalog/"))
    monkeypatch.setattr(runs, "capabilities", lambda: {"app-catalog": {"marker": "body"}})
    monkeypatch.setattr(runs.cutover, "run", lambda app_id: seen.setdefault("ran", app_id))
    monkeypatch.setattr(runs, "WARMUP_S", 0)
    monkeypatch.setattr(runs, "TAIL_S", 0)
    runs.do_cutover("app-catalog")
    assert seen == {"app_id": "app-catalog", "url": "http://alb/catalog/", "started": True, "ran": "app-catalog", "stopped": True}


def test_actions_need_the_operator_key_when_one_is_set(client, monkeypatch):
    monkeypatch.setenv("OPERATOR_KEY", "s3cret")
    assert client.get("/auth").json() == {"operator_required": True, "valid": False}
    assert client.get("/auth", headers={"X-Operator-Key": "s3cret"}).json()["valid"] is True
    r = client.post("/runs/discovery", json={"scope": "synthetic"})
    assert r.status_code == 401 and "operator key" in r.json()["detail"]
    assert client.post("/demo/reset", headers={"X-Operator-Key": "wrong"}).status_code == 401
    assert client.post("/demo/bad-wave", json={"app_id": "app-orders", "enabled": True}).status_code == 401
    # reads stay open for viewers
    assert client.get("/summary").status_code == 200 and client.get("/fleet").status_code == 200
    r = client.post("/runs/discovery", json={"scope": "synthetic"}, headers={"X-Operator-Key": "s3cret"})
    assert r.status_code == 202
    wait_idle()


def test_no_operator_key_means_open_for_local_dev(client, monkeypatch):
    monkeypatch.delenv("OPERATOR_KEY", raising=False)
    assert client.get("/auth").json() == {"operator_required": False, "valid": True}
    assert client.post("/demo/bad-wave", json={"app_id": "app-orders", "enabled": False}).status_code == 200


def test_copilot_is_rate_limited_per_viewer(client, monkeypatch):
    from orchestrator import main
    monkeypatch.setenv("OPERATOR_KEY", "s3cret")
    main._copilot_hits.clear()
    monkeypatch.setattr(main.copilot, "answer", lambda q: {"answer": "ok", "model": None, "fallback": True, "facts": []})
    h = {"X-Forwarded-For": "203.0.113.7"}
    codes = [client.post("/copilot", json={"question": "hi"}, headers=h).status_code for _ in range(main.COPILOT_PER_CLIENT + 1)]
    assert codes[:-1] == [200] * main.COPILOT_PER_CLIENT and codes[-1] == 429
    assert client.post("/copilot", json={"question": "hi"}, headers={**h, "X-Operator-Key": "s3cret"}).status_code == 200
    main._copilot_hits.clear()


def test_reset_destroy_renders_missing_generated_dirs(client, monkeypatch, tmp_path):
    """Instances applied from another machine still get destroyed: reset
    re-renders the terraform config for every provisionable real app."""
    store.upsert_apps([a for a in fixtures.apps() if a.app_id in ("app-catalog", "app-gitea")])
    monkeypatch.setattr(runs, "GENERATED", tmp_path / "generated")
    monkeypatch.setattr(runs.aws, "target_outputs", lambda: {"listener_rule_arns": {"app-catalog": "a"}})
    monkeypatch.setattr(runs, "capabilities", lambda: {"app-catalog": {"provision": True}, "app-gitea": {"provision": False}})
    monkeypatch.setattr(runs, "elbv2", lambda: "fake")
    monkeypatch.setattr(runs.weights, "set_weights", lambda *a, **k: None)
    rendered, destroyed = [], []

    def fake_build(app):
        (tmp_path / "generated" / app.app_id).mkdir(parents=True, exist_ok=True)
        (tmp_path / "generated" / app.app_id / "main.tf").write_text("# rendered")
        rendered.append(app.app_id)

    monkeypatch.setattr(runs.blueprint, "build", fake_build)
    monkeypatch.setattr(runs.terraform, "init", lambda *a, **k: None)
    monkeypatch.setattr(runs.terraform, "destroy", lambda app_id, d: destroyed.append(app_id))
    runs.do_reset(destroy=True)
    assert rendered == ["app-catalog"] and destroyed == ["app-catalog"]
