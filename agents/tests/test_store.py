import threading
from datetime import datetime, timedelta, timezone

import pytest

from agents.common import events, fixtures, store
from agents.common.models import AppStatus, EventType, TrafficSample


def test_upsert_apps_is_idempotent_and_filterable():
    apps = fixtures.apps()
    store.upsert_apps(apps)
    store.upsert_apps(apps)
    assert [a.app_id for a in store.get_apps()] == sorted(a.app_id for a in apps)
    assert len(store.get_apps(source="real")) == len(apps)
    assert store.get_apps(source="synthetic") == []


def test_set_status_updates_body_and_rejects_unknown():
    store.upsert_apps(fixtures.apps())
    store.set_status("app-orders", "PLANNED")
    assert {a.app_id: a.status for a in store.get_apps()}["app-orders"] == AppStatus.PLANNED
    with pytest.raises(ValueError):
        store.set_status("app-orders", "NOT_A_STATUS")
    with pytest.raises(KeyError):
        store.set_status("missing", "PLANNED")


def test_tiers_edges_plan_blueprint_cutover_roundtrip():
    store.upsert_tiers(fixtures.tiers())
    store.replace_edges(fixtures.edges())
    store.replace_edges(fixtures.edges()[:1])
    store.save_plan(fixtures.plan())
    store.save_blueprint(fixtures.blueprint())
    store.save_cutover(fixtures.cutover("app-orders"))
    assert len(store.get_tiers()) == len(fixtures.tiers())
    assert len(store.get_edges()) == 1
    assert store.get_plan() == fixtures.plan()
    assert store.get_blueprint("app-catalog") == fixtures.blueprint()
    assert store.get_cutover("app-orders").result == "ROLLED_BACK"
    assert store.get_blueprint("nope") is None and store.get_cutover("nope") is None


def test_traffic_window_only_returns_recent_samples():
    now = datetime.now(timezone.utc)
    old = TrafficSample(ts=now - timedelta(seconds=120), app_id="app-orders", status=200, latency_ms=10, served_by="legacy")
    new = TrafficSample(ts=now - timedelta(seconds=5), app_id="app-orders", status=500, latency_ms=10, served_by="target")
    other = TrafficSample(ts=now, app_id="app-catalog", status=200, latency_ms=10, served_by="legacy")
    store.insert_traffic([old, new, other])
    assert [s.status for s in store.traffic_window("app-orders", 60)] == [500]


def test_flags_and_reset():
    store.upsert_apps(fixtures.apps())
    store.set_flag("bad_wave", '{"app-orders": true}')
    events.emit("discovery", None, EventType.DISCOVERY_STARTED)
    assert store.get_flag("bad_wave") == '{"app-orders": true}'
    store.reset()
    assert store.get_apps() == [] and store.get_flag("bad_wave") is None and events.events_since(0) == []
    assert events.emit("discovery", None, EventType.DISCOVERY_STARTED).id == 1


def test_events_monotonic_batch_and_since():
    first = events.emit("discovery", None, EventType.DISCOVERY_STARTED, {"scope": "real"})
    batch = events.emit_batch("discovery", [("app-a", "APP_DISCOVERED", {}), ("app-b", "APP_DISCOVERED", None)])
    assert [e.id for e in batch] == [first.id + 1, first.id + 2]
    assert [e.app_id for e in events.events_since(first.id)] == ["app-a", "app-b"]
    assert events.events_since(0)[0].payload == {"scope": "real"}
    with pytest.raises(ValueError):
        events.emit("x", None, "NOT_AN_EVENT")


def test_concurrent_emits_from_threads_keep_unique_ids():
    def worker():
        for _ in range(25):
            events.emit("cutover", "app-orders", EventType.WEIGHT_SET, {"weight": 10})

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    ids = [e.id for e in events.events_since(0)]
    assert len(ids) == 100 and len(set(ids)) == 100
