import time
from datetime import date, datetime, timezone

import pytest

from agents import discovery, planning
from agents.common import events, fixtures, store
from agents.common.models import AppStatus, EventType, Tier
from agents.discovery import normalize, scanner, synthetic
from agents.planning.planner import build_plan, wave_dates
from agents.tests.aws_fakes import FakeClient

NOW = datetime(2026, 9, 26, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def fleet_world():
    real = normalize.normalize(scanner.scan(FakeClient(), FakeClient(), ["vpc-0bc12dd6664275ce7"]), now=NOW)
    return discovery.discover(real, synthetic.load_fleet())


def _assert_providers_first(plan, edges):
    wave_of = {a: w.wave for w in plan.waves for a in w.app_ids}
    pos = {a: i for w in plan.waves for i, a in enumerate(w.app_ids)}
    for e in edges:
        if e.from_ in wave_of and e.to in wave_of:
            assert (wave_of[e.to], pos[e.to]) < (wave_of[e.from_], pos[e.from_]), \
                f"consumer {e.from_} scheduled before provider {e.to}"


def test_real_apps_form_the_pilot_providers_first():
    plan = build_plan(fixtures.apps(), fixtures.tiers(), fixtures.edges(), start_date=date(2026, 9, 28), now=NOW)
    assert plan.waves[0].app_ids == ["app-catalog", "app-pricing", "app-orders", "app-juice-shop"]
    assert plan.waves[0].name == "Pilot" and plan.parked == ["app-gitea", "app-vaultwarden"]


def test_thousand_apps_plan_fast_and_valid(fleet_world):
    apps, edges, tiers = fleet_world
    start = time.monotonic()
    plan = build_plan(apps, tiers, edges, capacity_per_wave=40, start_date=date(2026, 9, 28), now=NOW)
    assert time.monotonic() - start < 1
    red = {t.app_id for t in tiers if t.tier == Tier.RED}
    assert set(plan.parked) == red
    scheduled = [a for w in plan.waves for a in w.app_ids]
    assert len(scheduled) == len(set(scheduled)) == len(apps) - len(red)
    assert plan.waves[0].app_ids == ["app-catalog", "app-pricing", "app-orders", "app-juice-shop"]
    _assert_providers_first(plan, edges)


def test_capacity_respected_with_gray_counting_double(fleet_world):
    apps, edges, tiers = fleet_world
    tier_of = {t.app_id: t.tier for t in tiers}
    plan = build_plan(apps, tiers, edges, capacity_per_wave=40, start_date=date(2026, 9, 28), now=NOW)
    for w in plan.waves[1:]:
        used = sum(2 if tier_of[a] == Tier.GRAY else 1 for a in w.app_ids)
        assert used <= 40 or len(w.app_ids) <= 5  # only an unsplittable unit may overflow


def test_projection_moves_with_capacity(fleet_world):
    apps, edges, tiers = fleet_world
    slow = build_plan(apps, tiers, edges, capacity_per_wave=10, start_date=date(2026, 9, 28), now=NOW)
    fast = build_plan(apps, tiers, edges, capacity_per_wave=80, start_date=date(2026, 9, 28), now=NOW)
    assert len(slow.waves) > len(fast.waves)
    assert slow.projection.projected_finish > fast.projection.projected_finish
    assert fast.projection.meets_target_2027


def test_wave_dates_skip_the_freeze_and_spread_across_the_week():
    dates = wave_dates(date(2026, 12, 7), 3, 6)
    assert all(not ((d.month == 12 and d.day >= 15) or (d.month == 1 and d.day <= 5)) for d in dates)
    assert [d.weekday() for d in dates[:3]] == [0, 2, 4]
    assert dates[3] == date(2026, 12, 14)  # Monday before the freeze starts on the 15th
    assert dates[4] >= date(2027, 1, 6)


def test_run_uses_store_sets_statuses_and_emits(fleet_world):
    apps, edges, tiers = fleet_world
    store.upsert_apps(apps)
    store.upsert_tiers(tiers)
    store.replace_edges(edges)
    plan = planning.run(capacity_per_wave=40, start_date=date(2026, 9, 28))
    assert store.get_plan() == plan
    statuses = {a.app_id: a.status for a in store.get_apps()}
    assert all(statuses[a] == AppStatus.PARKED for a in plan.parked)
    assert statuses["app-catalog"] == AppStatus.PLANNED
    assert events.events_since(0)[-1].type == EventType.PLAN_DONE


def test_run_without_discovery_fails_loudly():
    with pytest.raises(RuntimeError):
        planning.run()
    assert events.events_since(0)[-1].type == EventType.ERROR
