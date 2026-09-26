from agents.common import fixtures
from agents.common.models import FindingCode, Tier

BASELINE = {
    "SG_OPEN_SSH", "SG_OPEN_APP", "EBS_UNENCRYPTED", "IMDSV1", "OLD_AMI", "NO_VPC_SEGMENTATION", "PUBLIC_IP",
}


def test_every_fixture_validates():
    fixtures.apps(), fixtures.tiers(), fixtures.edges(), fixtures.plan(), fixtures.summary()
    fixtures.blueprint("app-catalog"), fixtures.cutover("app-catalog"), fixtures.cutover("app-orders")
    fixtures.traffic("app-orders")
    assert len(fixtures.events()) >= 50


def test_expected_findings_after_d1_d2():
    by_id = {a.app_id: {f.value for f in a.findings} for a in fixtures.apps()}
    assert by_id["app-catalog"] == BASELINE
    assert by_id["app-pricing"] == BASELINE | {"MISSING_TAGS", "HARDCODED_IP"}  # D1: pricing's CATALOG_URL has an IP
    assert by_id["app-orders"] == BASELINE | {"MISSING_TAGS", "HARDCODED_IP"}


def test_all_three_real_apps_golden_d2():
    assert {t.app_id: t.tier for t in fixtures.tiers()} == {
        "app-catalog": Tier.GOLDEN, "app-pricing": Tier.GOLDEN, "app-orders": Tier.GOLDEN,
    }


def test_references_point_at_known_apps():
    ids = {a.app_id for a in fixtures.apps()}
    assert {t.app_id for t in fixtures.tiers()} == ids
    for e in fixtures.edges():
        assert e.from_ in ids and e.to in ids
    for w in fixtures.plan().waves:
        assert set(w.app_ids) <= ids


def test_edges_are_consumer_to_provider_with_all_three_signals():
    assert {(e.from_, e.to): set(e.signals) for e in fixtures.edges()} == {
        ("app-orders", "app-pricing"): {"tag", "ssm", "sg_ref"},
        ("app-pricing", "app-catalog"): {"tag", "ssm", "sg_ref"},
    }


def test_wave_zero_is_providers_first():
    assert fixtures.plan().waves[0].app_ids == ["app-catalog", "app-pricing", "app-orders"]


def test_summary_counts_match_apps():
    s, apps = fixtures.summary(), fixtures.apps()
    assert s.apps_total == len(apps) and s.edges == len(fixtures.edges())
    for code in FindingCode:
        assert s.findings.get(code, 0) == sum(code in a.findings for a in apps)


def test_bad_wave_fixture_rolls_back_at_ten_percent():
    run = fixtures.cutover("app-orders")
    assert run.result == "ROLLED_BACK" and run.rollback.at_weight == 10


def test_events_have_monotonic_ids():
    ids = [e.id for e in fixtures.events()]
    assert ids == sorted(ids) and len(ids) == len(set(ids))
