import time

import pytest

from agents import blueprint, discovery
from agents.blueprint import diff as diffmod
from agents.blueprint import mapper_rules, render, schema, terraform
from agents.common import events, fixtures, store
from agents.common.models import AppStatus, EventType, GoldenInputs, Source
from agents.discovery import synthetic

# ---------------------------------------------------------------- mapper_rules


def test_catalog_needs_no_defaults():
    app = {a.app_id: a for a in fixtures.apps()}["app-catalog"]
    inputs, gaps = mapper_rules.map_app(app)
    assert inputs.port == 8080 and inputs.instance_type == "t3.micro" and inputs.env == {}
    assert inputs.tags == {"owner": "team-x", "cost-center": "cc-1", "data-class": "internal"}
    assert gaps == []


def test_orders_rewrites_its_hardcoded_ip_to_the_alb_path():
    """This is the CONTRACTS.md BlueprintResult example, verbatim."""
    app = {a.app_id: a for a in fixtures.apps()}["app-orders"]
    inputs, gaps = mapper_rules.map_app(app)
    assert inputs.env == {
        "UPSTREAM_URL": "http://mig-edge-alb-1536629619.ap-south-1.elb.amazonaws.com/pricing/",
        "REQUIRE_UPSTREAM": "1",
    }
    assert {g.field for g in gaps} == {"owner", "cost-center", "data-class"}


def test_missing_instance_type_defaults_and_flags_a_gap():
    app = {a.app_id: a for a in fixtures.apps()}["app-pricing"]
    weird = app.model_copy(update={"runtime": app.runtime.model_copy(update={"instance_type": "m5.xlarge"})})
    inputs, gaps = mapper_rules.map_app(weird)
    assert inputs.instance_type == "t3.micro"
    assert any(g.field == "instance_type" for g in gaps)


# ---------------------------------------------------------------- schema


def test_schema_rejects_a_leftover_ip_literal():
    bad = GoldenInputs(name="x", port=8080, instance_type="t3.micro",
                        env={"UPSTREAM_URL": "http://10.10.1.40:8080/"},
                        tags={"owner": "a", "cost-center": "b", "data-class": "c"})
    with pytest.raises(schema.ValidationError):
        schema.validate(bad)


def test_schema_rejects_a_disallowed_instance_type():
    bad = GoldenInputs(name="x", port=8080, instance_type="m5.xlarge", tags={"owner": "a", "cost-center": "b", "data-class": "c"})
    with pytest.raises(schema.ValidationError):
        schema.validate(bad)


def test_schema_rejects_missing_tags():
    bad = GoldenInputs(name="x", port=8080, instance_type="t3.micro", tags={"owner": "a"})
    with pytest.raises(schema.ValidationError):
        schema.validate(bad)


def test_schema_accepts_a_clean_input():
    good = GoldenInputs(name="x", port=8080, instance_type="t3.micro", tags={"owner": "a", "cost-center": "b", "data-class": "c"})
    schema.validate(good)  # no raise


# ---------------------------------------------------------------- render + diff


def test_render_wires_from_target_outputs_only(tmp_path):
    app = {a.app_id: a for a in fixtures.apps()}["app-orders"]
    inputs, _ = mapper_rules.map_app(app)
    text, tf_dir = render.render("app-orders", inputs, write=False)
    assert 'source           = "../../infra/terraform/modules/golden_app"' in text
    assert "tg-app-orders-target" in text
    assert "/orders" in text
    assert not tf_dir.exists()  # write=False never touches disk


def test_render_write_true_creates_the_file(monkeypatch, tmp_path):
    monkeypatch.setattr(render, "GENERATED_DIR", tmp_path)
    app = {a.app_id: a for a in fixtures.apps()}["app-catalog"]
    inputs, _ = mapper_rules.map_app(app)
    text, tf_dir = render.render("app-catalog", inputs, write=True)
    assert (tf_dir / "main.tf").read_text(encoding="utf-8") == text


@pytest.mark.parametrize("app_id", ["app-catalog", "app-pricing", "app-orders"])
def test_diff_has_at_least_7_annotations_per_real_app(app_id):
    app = {a.app_id: a for a in fixtures.apps()}[app_id]
    inputs, _ = mapper_rules.map_app(app)
    text, _ = render.render(app_id, inputs, write=False)
    diff, fixes = diffmod.build(app, text)
    assert len(diff.annotations) >= 7
    assert len(fixes) == len(diff.annotations)
    assert {a.finding for a in diff.annotations} == set(app.findings) - {"STATEFUL"}


def test_old_ami_annotation_points_at_the_module_source_line():
    app = {a.app_id: a for a in fixtures.apps()}["app-catalog"]
    inputs, _ = mapper_rules.map_app(app)
    text, _ = render.render("app-catalog", inputs, write=False)
    diff, _ = diffmod.build(app, text)
    ami = next(a for a in diff.annotations if a.finding == "OLD_AMI")
    lines = text.splitlines()
    assert "golden_app" in lines[ami.after_line - 1]


# ---------------------------------------------------------------- build() / run()


@pytest.fixture(autouse=True)
def _store_apps():
    store.upsert_apps(fixtures.apps())
    yield


@pytest.fixture(autouse=True)
def _isolated_generated_dir(tmp_path, monkeypatch):
    """Every real-app build() writes generated/<app>/main.tf; keep that out
    of the actual repo tree regardless of which test path exercises it."""
    monkeypatch.setattr(render, "GENERATED_DIR", tmp_path / "generated")


def test_build_is_pure_and_schema_valid():
    app = {a.app_id: a for a in fixtures.apps()}["app-pricing"]
    result = blueprint.build(app)
    schema.validate(result.inputs)  # doesn't raise
    assert result.status == AppStatus.BLUEPRINTED and not result.applied and result.outputs is None


def test_run_synthetic_is_a_dry_run_with_no_terraform(monkeypatch):
    monkeypatch.setattr(terraform, "_run", lambda *a, **k: (_ for _ in ()).throw(AssertionError("terraform must not run")))
    app = fixtures.apps()[0].model_copy(update={"app_id": "syn-00001", "source": Source.SYNTHETIC})
    store.upsert_apps([app])
    result = blueprint.run("syn-00001")
    assert result.status == AppStatus.BLUEPRINTED and result.tf_dir == "generated/syn-00001"
    assert store.get_blueprint("syn-00001").app_id == "syn-00001"
    assert {a.app_id: a.status for a in store.get_apps()}["syn-00001"] == AppStatus.BLUEPRINTED
    types = [e.type for e in events.events_since(0)]
    assert EventType.BLUEPRINT_DRY_RUN in types


def test_run_real_app_without_apply_validates_locally(monkeypatch):
    calls = []
    monkeypatch.setattr(terraform, "init", lambda app_id, tf_dir, backend=True: calls.append(("init", backend)))
    monkeypatch.setattr(terraform, "validate", lambda app_id, tf_dir: {"valid": True})
    result = blueprint.run("app-catalog", apply=False)
    assert calls == [("init", False)]  # -backend=false for a local-only validate
    assert result.validate_ok and result.status == AppStatus.BLUEPRINTED and not result.applied
    assert {a.app_id: a.status for a in store.get_apps()}["app-catalog"] == AppStatus.BLUEPRINTED


def test_run_real_app_with_apply_provisions_and_polls_health(monkeypatch):
    monkeypatch.setattr(terraform, "init", lambda *a, **k: None)
    monkeypatch.setattr(terraform, "validate", lambda *a, **k: {"valid": True})
    monkeypatch.setattr(terraform, "plan", lambda *a, **k: {})
    monkeypatch.setattr(terraform, "apply", lambda *a, **k: "")
    monkeypatch.setattr(blueprint, "_wait_healthy", lambda tg_arn, timeout_s=180: (True, ["i-0new"]))

    result = blueprint.run("app-catalog", apply=True)
    assert result.status == AppStatus.PROVISIONED and result.applied
    assert result.outputs.instance_ids == ["i-0new"]
    assert result.outputs.tg_target_arn.endswith("tg-app-catalog-target/23ffea897f6d8bad")
    assert {a.app_id: a.status for a in store.get_apps()}["app-catalog"] == AppStatus.PROVISIONED
    assert events.events_since(0)[-1].type == EventType.PROVISIONED


def test_run_marks_failed_on_a_terraform_error(monkeypatch):
    monkeypatch.setattr(terraform, "init", lambda *a, **k: None)

    def boom(*a, **k):
        raise terraform.TerraformError("validate", 1, "syntax error")

    monkeypatch.setattr(terraform, "validate", boom)
    result = blueprint.run("app-catalog", apply=False)
    assert result.status == AppStatus.FAILED
    assert {a.app_id: a.status for a in store.get_apps()}["app-catalog"] == AppStatus.FAILED
    assert events.events_since(0)[-1].type == EventType.BLUEPRINT_FAILED


def test_bad_wave_drops_upstream_url_but_keeps_require_upstream():
    store.set_flag("bad_wave", '{"app-orders": true}')
    result = blueprint.build({a.app_id: a for a in fixtures.apps()}["app-orders"])
    assert "UPSTREAM_URL" not in result.inputs.env
    assert result.inputs.env.get("REQUIRE_UPSTREAM") == "1"
    schema.validate(result.inputs)  # still valid Terraform, just broken at runtime


def test_fix_and_retry_uses_replace(monkeypatch):
    monkeypatch.setattr(terraform, "init", lambda *a, **k: None)
    monkeypatch.setattr(terraform, "validate", lambda *a, **k: {"valid": True})
    replace_calls = []
    monkeypatch.setattr(terraform, "apply_replace", lambda app_id, tf_dir, resource="module.app.aws_instance.this": replace_calls.append(resource))
    monkeypatch.setattr(blueprint, "_wait_healthy", lambda tg_arn, timeout_s=180: (True, ["i-0new"]))

    result = blueprint.retry("app-orders")
    assert replace_calls == ["module.app.aws_instance.this"]
    assert result.status == AppStatus.PROVISIONED


def test_idempotent_rerun_of_the_same_app():
    r1 = blueprint.build({a.app_id: a for a in fixtures.apps()}["app-pricing"])
    r2 = blueprint.build({a.app_id: a for a in fixtures.apps()}["app-pricing"])
    assert r1.inputs == r2.inputs and r1.diff == r2.diff


# ---------------------------------------------------------------- synthetic scale


def test_thousand_synthetic_dry_runs_under_30s():
    fleet = synthetic.load_fleet()
    apps, edges, _tiers = discovery.discover([], fleet)
    store.upsert_apps(apps)
    start = time.monotonic()
    count = blueprint.dry_run_synthetic()
    elapsed = time.monotonic() - start
    assert count == 1000 and elapsed < 30, f"{elapsed:.1f}s"
    statuses = {a.app_id: a.status for a in store.get_apps(source="synthetic")}
    assert all(s == AppStatus.BLUEPRINTED for s in statuses.values())
    batches = [e for e in events.events_since(0) if e.type == EventType.BLUEPRINT_DRY_RUN]
    assert sum(len(b.payload["app_ids"]) for b in batches) == 1000
