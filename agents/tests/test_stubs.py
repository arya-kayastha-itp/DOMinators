from agents import blueprint, cutover, discovery, planning
from agents.common import events, store
from agents.common.models import AppStatus, EventType


def test_discovery_stub_fills_store_and_emits():
    summary = discovery.run("real")
    assert summary.apps_total == 3 and len(store.get_apps()) == 3 and len(store.get_edges()) == 2
    types = [e.type for e in events.events_since(0)]
    assert types[0] == EventType.DISCOVERY_STARTED and types[-1] == EventType.DISCOVERY_DONE
    assert types.count(EventType.APP_DISCOVERED) == 3


def test_planning_stub_marks_apps_planned():
    discovery.run()
    plan = planning.run(capacity_per_wave=25)
    assert plan.capacity_per_wave == 25 and store.get_plan() == plan
    assert {a.status for a in store.get_apps()} == {AppStatus.PLANNED}


def test_blueprint_stub_is_per_app_and_idempotent():
    discovery.run()
    r1 = blueprint.run("app-pricing", apply=True)
    r2 = blueprint.run("app-pricing", apply=True)
    assert r1 == r2 and r1.app_id == "app-pricing" and r1.status == AppStatus.PROVISIONED
    assert store.get_blueprint("app-pricing").inputs.name == "app-pricing"
    assert blueprint.run("app-orders").outputs is None


def test_cutover_stub_follows_bad_wave_flag():
    discovery.run()
    assert cutover.run("app-catalog").result == "MIGRATED"
    store.set_flag("bad_wave", '{"app-orders": true}')
    run = cutover.run("app-orders")
    assert run.result == "ROLLED_BACK" and run.app_id == "app-orders"
    assert {a.app_id: a.status for a in store.get_apps()}["app-orders"] == AppStatus.ROLLED_BACK
