"""Blueprint and Cutover are still G0 stubs (Track 3 owns the real ones)."""

from agents import blueprint, cutover
from agents.common import fixtures, store
from agents.common.models import AppStatus


def test_blueprint_stub_is_per_app_and_idempotent():
    store.upsert_apps(fixtures.apps())
    r1 = blueprint.run("app-pricing", apply=True)
    r2 = blueprint.run("app-pricing", apply=True)
    assert r1 == r2 and r1.app_id == "app-pricing" and r1.status == AppStatus.PROVISIONED
    assert store.get_blueprint("app-pricing").inputs.name == "app-pricing"
    assert blueprint.run("app-orders").outputs is None


def test_cutover_stub_follows_bad_wave_flag():
    store.upsert_apps(fixtures.apps())
    assert cutover.run("app-catalog").result == "MIGRATED"
    store.set_flag("bad_wave", '{"app-orders": true}')
    run = cutover.run("app-orders")
    assert run.result == "ROLLED_BACK" and run.app_id == "app-orders"
    assert {a.app_id: a.status for a in store.get_apps()}["app-orders"] == AppStatus.ROLLED_BACK
