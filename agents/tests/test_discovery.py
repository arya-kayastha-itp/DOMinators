import time
from datetime import datetime, timezone

import pytest

from agents import discovery
from agents.common import events, fixtures, store
from agents.common.models import (
    AppRecord, AppStatus, EventType, FindingCode, Network, Runtime, SgRule, Source, Storage, Tier,
)
from agents.discovery import deps, normalize, rules, scanner, synthetic, tiering
from agents.discovery.scanner import RawScan
from agents.tests.aws_fakes import FakeClient

VPC = "vpc-0bc12dd6664275ce7"
NOW = datetime(2026, 9, 26, tzinfo=timezone.utc)


@pytest.fixture
def raw():
    return scanner.scan(FakeClient(), FakeClient(), [VPC])


@pytest.fixture
def real_apps(raw):
    return normalize.normalize(raw, now=NOW)


# ---------------------------------------------------------------- scanner


def test_scanner_is_scoped_and_includes_deprecated_images():
    ec2 = FakeClient()
    raw = scanner.scan(ec2, FakeClient(), [VPC])
    assert len(raw.instances) == 3 and len(raw.images) == 1
    calls = dict(ec2.calls)
    assert calls["describe_images"]["IncludeDeprecated"] is True
    assert {"Name": "vpc-id", "Values": [VPC]} in calls["describe_instances"]["Filters"]


def test_scanner_refuses_to_scan_the_whole_account():
    with pytest.raises(ValueError):
        scanner.scan(FakeClient(), FakeClient(), [])


# ---------------------------------------------------------------- normalize


def test_normalize_groups_by_name_and_reads_raw_facts(real_apps):
    by_id = {a.app_id: a for a in real_apps}
    assert set(by_id) == {"app-catalog", "app-pricing", "app-orders"}
    cat = by_id["app-catalog"]
    # AMI created 2023-03-13T23:52Z -> 1292 full days at NOW (midnight 2026-09-26)
    assert cat.runtime.port == 8080 and cat.runtime.ami_age_days == 1292
    assert cat.network.public_ip and not cat.network.vpc_has_private_subnet
    assert not cat.storage.ebs_encrypted and not cat.metadata.imds_v2_required
    assert by_id["app-pricing"].config.env == {"CATALOG_URL": "http://10.10.1.61:8080"}
    assert "aws:cloudformation:stack-name" not in cat.tags


def test_effective_route_table_not_any_route_table(raw):
    # Live gotcha: the VPC's unused main route table has no IGW route. That must NOT
    # count as a private subnet, because no subnet actually uses it.
    assert not normalize.normalize(raw, now=NOW)[0].network.vpc_has_private_subnet
    # But a subnet that falls back to that main table IS private.
    extra = {"SubnetId": "subnet-private", "VpcId": VPC, "MapPublicIpOnLaunch": False}
    segmented = RawScan(**{**raw.__dict__, "subnets": raw.subnets + [extra]})
    assert normalize.normalize(segmented, now=NOW)[0].network.vpc_has_private_subnet


def test_undescribable_ami_is_reported_not_skipped(raw):
    no_images = RawScan(**{**raw.__dict__, "images": []})
    app = normalize.normalize(no_images, now=NOW)[0]
    assert app.runtime.ami_age_days is None and "could not be described" in app.runtime.ami_age_reason
    assert FindingCode.OLD_AMI in rules.evaluate(app)


# ---------------------------------------------------------------- rules


def _app(**kw):
    base = dict(app_id="x", source=Source.SYNTHETIC, name="x",
                runtime=Runtime(port=8080, ami_age_days=10), storage=Storage(ebs_encrypted=True),
                network=Network(vpc_has_private_subnet=True),
                tags={"owner": "a", "cost-center": "b", "data-class": "c"})
    base.update(kw)
    app = AppRecord(**base)
    app.metadata.imds_v2_required = True
    return app


def test_a_clean_app_has_no_findings():
    assert rules.evaluate(_app()) == []


@pytest.mark.parametrize("code, app", [
    ("SG_OPEN_SSH", lambda: _app(network=Network(vpc_has_private_subnet=True, sg_ingress=[SgRule(port=22, cidr="0.0.0.0/0")]))),
    ("SG_OPEN_APP", lambda: _app(network=Network(vpc_has_private_subnet=True, sg_ingress=[SgRule(port=8080, cidr="::/0")]))),
    ("SG_OPEN_SSH", lambda: _app(network=Network(vpc_has_private_subnet=True, sg_ingress=[SgRule(port=-1, cidr="0.0.0.0/0")]))),
    ("EBS_UNENCRYPTED", lambda: _app(storage=Storage(ebs_encrypted=False))),
    ("OLD_AMI", lambda: _app(runtime=Runtime(port=8080, ami_age_days=366))),
    ("NO_VPC_SEGMENTATION", lambda: _app(network=Network(vpc_has_private_subnet=False))),
    ("PUBLIC_IP", lambda: _app(network=Network(vpc_has_private_subnet=True, public_ip=True))),
    ("MISSING_TAGS", lambda: _app(tags={"owner": "a", "cost-center": "b"})),
    ("HARDCODED_IP", lambda: _app(config={"env": {"U": "http://10.1.2.3:80"}})),
    ("STATEFUL", lambda: _app(tags={"owner": "a", "cost-center": "b", "data-class": "c"}, runtime=Runtime(port=8080, ami_age_days=10, stateful=True))),
    ("STATEFUL", lambda: _app(network=Network(vpc_has_private_subnet=True, sg_ingress=[SgRule(port=5432, cidr="10.0.0.0/8")]))),
    ("STATEFUL", lambda: _app(storage=Storage(ebs_encrypted=True, extra_volume_gb=200))),
])
def test_each_rule_fires_on_its_own(code, app):
    assert code in rules.evaluate(app())


def test_imdsv1_rule():
    app = _app()
    app.metadata.imds_v2_required = False
    assert rules.evaluate(app) == [FindingCode.IMDSV1]


def test_hostname_urls_and_version_numbers_are_not_ips():
    assert not rules.hardcoded_ip(_app(config={"env": {"U": "http://syn-00012.internal:8080", "V": "1.2.3"}}))


# ---------------------------------------------------------------- oracle + G0 fixtures


def test_oracle_matches_the_legacy_findings_tag(real_apps):
    """T2-D-9: computed findings vs. each instance's `findings` tag (never an input)."""
    for app in rules.apply(real_apps):
        expected = set(app.tags["findings"].split(","))
        if app.app_id == "app-pricing":
            expected.add("HARDCODED_IP")  # D1: the tag predates this decision
        assert {f.value for f in app.findings} == expected, app.app_id


def test_discovery_recomputes_the_g0_fixtures_exactly(real_apps):
    apps, edges, tiers = discovery.discover(real_apps, [])
    assert {a.app_id: a.findings for a in apps} == {a.app_id: a.findings for a in fixtures.apps()}
    assert {(e.from_, e.to): e.signals for e in edges} == {(e.from_, e.to): e.signals for e in fixtures.edges()}
    assert {t.app_id: (t.tier, t.score) for t in tiers} == {t.app_id: (t.tier, t.score) for t in fixtures.tiers()}
    assert {a.app_id: a.depends_on for a in apps} == {a.app_id: a.depends_on for a in fixtures.apps()}


# ---------------------------------------------------------------- tiering


def test_tiering_edge_cases():
    stateful = _app(runtime=Runtime(port=8080, ami_age_days=10, stateful=True))
    stateful = stateful.model_copy(update={"findings": rules.evaluate(stateful)})
    assert tiering.rules_tier(stateful, 0).tier == Tier.RED
    commercial = _app(license="commercial")
    assert tiering.rules_tier(commercial, 0).tier == Tier.RED
    ecs = _app(runtime=Runtime(type="ecs", port=8080, ami_age_days=10))
    assert tiering.rules_tier(ecs, 0).tier == Tier.GRAY
    unknown = _app(runtime=Runtime(type="unknown", port=8080, ami_age_days=10))
    assert tiering.rules_tier(unknown, 0).score == 60
    hub = _app().model_copy(update={"findings": [FindingCode.HARDCODED_IP]})
    t = tiering.rules_tier(hub, 6)
    assert (t.score, t.tier) == (75, Tier.GOLDEN)


# ---------------------------------------------------------------- run() + synthetic


def test_run_real_persists_and_emits(real_apps):
    summary = discovery.run("real", real_apps=real_apps)
    assert (summary.apps_total, summary.real, summary.edges) == (3, 3, 2)
    assert summary.tiers == {Tier.GOLDEN: 3, Tier.GRAY: 0, Tier.RED: 0}
    assert {a.status for a in store.get_apps()} == {AppStatus.TIERED}
    types = [e.type for e in events.events_since(0)]
    assert types[0] == EventType.DISCOVERY_STARTED and types[-1] == EventType.DISCOVERY_DONE
    assert types.count(EventType.APP_DISCOVERED) == 3


def test_partial_scope_keeps_the_other_sides_edges(real_apps):
    discovery.run("synthetic")
    synthetic_edges = len(store.get_edges())
    discovery.run("real", real_apps=real_apps)
    assert len(store.get_edges()) == synthetic_edges + 2


def test_rerun_is_idempotent(real_apps):
    discovery.run("real", real_apps=real_apps)
    discovery.run("real", real_apps=real_apps)
    assert len(store.get_apps()) == 3 and len(store.get_edges()) == 2


def test_synthetic_fleet_scale_and_tier_mix():
    fleet = synthetic.load_fleet()
    start = time.monotonic()
    _, edges, tiers = discovery.discover([], fleet)
    elapsed = time.monotonic() - start
    assert len(fleet) == 1000 and elapsed < 3, f"{elapsed:.2f}s"
    share = {t: sum(x.tier == t for x in tiers) / len(tiers) for t in Tier}
    assert abs(share[Tier.GOLDEN] - 0.60) < 0.05 and abs(share[Tier.GRAY] - 0.25) < 0.05
    assert abs(share[Tier.RED] - 0.15) < 0.05
    assert all(e.source == Source.SYNTHETIC for e in edges)


def test_synthetic_events_are_batched_by_50():
    discovery.run("synthetic")
    batches = [e for e in events.events_since(0) if e.type == EventType.APP_DISCOVERED]
    assert len(batches) == 20 and all(len(b.payload["app_ids"]) == 50 for b in batches)
