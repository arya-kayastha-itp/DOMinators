"""Blueprint/IaC agent (Track 3 / A3): AppRecord -> GoldenInputs -> generated
Terraform -> (real apps, --apply) a live `terraform apply` into Account B.

Real apps: map -> validate -> render -> diff -> init -> validate -> (apply:
plan -> apply -> wait for target health). Synthetic apps: steps 1-5 only, no
terraform, no disk writes — `dry_run_synthetic` batches BLUEPRINT_DRY_RUN
events like Discovery batches APP_DISCOVERED.

Works end to end with LLM_BACKEND=off (mapper_rules is the fallback path
mapper_llm always has); Bedrock only makes env/tag mapping less mechanical
once Track 4's llm.py exists.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from agents.blueprint import diff as diffmod
from agents.blueprint import mapper_llm, render, schema, terraform
from agents.common import aws, events, store
from agents.common.models import AppRecord, AppStatus, BlueprintOutputs, BlueprintResult, EventType, Source

AGENT = "blueprint"
HEALTH_TIMEOUT_S = 180
HEALTH_POLL_S = 3
DRY_RUN_BATCH = 50


def _bad_wave_on(app_id: str) -> bool:
    flag = store.get_flag("bad_wave")
    return bool(flag) and bool(json.loads(flag).get(app_id))


def _target_group_session():
    return aws.agent_runner() if os.getenv("AGENT_RUNNER_ROLE_ARN") else aws.target()


def _wait_healthy(tg_arn: str, timeout_s: int = HEALTH_TIMEOUT_S) -> tuple[bool, list[str]]:
    elbv2 = _target_group_session().client("elbv2")
    deadline = time.monotonic() + timeout_s
    while True:
        descriptions = elbv2.describe_target_health(TargetGroupArn=tg_arn)["TargetHealthDescriptions"]
        instance_ids = [d["Target"]["Id"] for d in descriptions]
        if descriptions and all(d["TargetHealth"]["State"] == "healthy" for d in descriptions):
            return True, instance_ids
        if time.monotonic() >= deadline:
            return False, instance_ids
        time.sleep(HEALTH_POLL_S)


def build(app: AppRecord, *, bad_wave: bool | None = None) -> BlueprintResult:
    """Steps 1-5: map -> (bad-wave hook) -> validate -> render -> diff.
    No terraform, no AWS calls beyond reading the local target_outputs.json.

    `bad_wave` defaults to a store lookup (the single-app path); a batch
    caller like `dry_run_synthetic` resolves the flag once and passes it in,
    instead of re-querying the store once per app in a 1,000-app loop."""
    inputs, gaps, _used_llm = mapper_llm.map_app(app)
    is_bad_wave = _bad_wave_on(app.app_id) if bad_wave is None else bad_wave

    if is_bad_wave:
        # T3-B-8: dropped *after* validation would still be wrong Terraform
        # to hand to `terraform validate`, so we drop it before validating —
        # the point is valid HCL that's broken at runtime, not invalid HCL.
        inputs = inputs.model_copy(update={"env": {k: v for k, v in inputs.env.items() if k != "UPSTREAM_URL"}})

    schema.validate(inputs)
    text, tf_dir = render.render(app.app_id, inputs, write=app.source == Source.REAL)
    diff, fixes = diffmod.build(app, text)

    return BlueprintResult(
        app_id=app.app_id,
        inputs=inputs,
        fixes=fixes,
        gaps=gaps,
        diff=diff,
        tf_dir=f"generated/{app.app_id}",
        validate_ok=False,
        applied=False,
        status=AppStatus.BLUEPRINTED,
    )


def _outputs_for(app_id: str) -> BlueprintOutputs:
    data = aws.target_outputs()
    return BlueprintOutputs(
        tg_target_arn=data.get("target_group_arns", {}).get(app_id),
        tg_legacy_arn=data.get("legacy_target_group_arns", {}).get(app_id),
        listener_rule_arn=data.get("listener_rule_arns", {}).get(app_id),
    )


def _fail(result: BlueprintResult, app_id: str, step: str, error: str) -> BlueprintResult:
    result = result.model_copy(update={"status": AppStatus.FAILED})
    store.save_blueprint(result)
    if app_id in {a.app_id for a in store.get_apps()}:
        store.set_status(app_id, AppStatus.FAILED)
    events.emit(AGENT, app_id, EventType.BLUEPRINT_FAILED, {"step": step, "error": error}, level="error")
    return result


def _apply_and_wait(app_id: str, result: BlueprintResult, tf_dir: Path, *, replace: bool = False) -> BlueprintResult:
    if replace:
        terraform.apply_replace(app_id, tf_dir)
    else:
        terraform.plan(app_id, tf_dir)
        terraform.apply(app_id, tf_dir)
    outputs = _outputs_for(app_id)
    if outputs.tg_target_arn:
        healthy, instance_ids = _wait_healthy(outputs.tg_target_arn)
    else:
        healthy, instance_ids = False, []
    outputs = outputs.model_copy(update={"instance_ids": instance_ids})
    status = AppStatus.PROVISIONED if healthy else AppStatus.FAILED
    result = result.model_copy(update={"applied": True, "outputs": outputs, "status": status})
    store.save_blueprint(result)
    store.set_status(app_id, status)
    if status == AppStatus.PROVISIONED:
        events.emit(AGENT, app_id, EventType.PROVISIONED, {"outputs": outputs.to_dict()})
    else:
        events.emit(AGENT, app_id, EventType.BLUEPRINT_FAILED, {"step": "health check timed out"}, level="error")
    return result


def run(app_id: str, apply: bool = False) -> BlueprintResult:
    apps = {a.app_id: a for a in store.get_apps()}
    app = apps.get(app_id)
    if app is None:
        events.emit(AGENT, app_id, EventType.ERROR, {"error": "unknown app_id — run discovery first"}, level="error")
        raise KeyError(f"unknown app_id: {app_id}")

    result = build(app)

    if app.source != Source.REAL:
        store.save_blueprint(result)
        store.set_status(app_id, AppStatus.BLUEPRINTED)
        events.emit(AGENT, app_id, EventType.BLUEPRINT_DRY_RUN, {"fixes": len(result.fixes), "gaps": len(result.gaps)})
        return result

    tf_dir = Path(result.tf_dir)
    try:
        terraform.init(app_id, tf_dir, backend=apply)
        validate_out = terraform.validate(app_id, tf_dir)
    except terraform.TerraformError as exc:
        return _fail(result, app_id, exc.step, str(exc))

    result = result.model_copy(update={"validate_ok": bool(validate_out.get("valid"))})
    events.emit(AGENT, app_id, EventType.BLUEPRINT_READY, {"fixes": len(result.fixes), "validate_ok": result.validate_ok})

    if not apply:
        store.save_blueprint(result)
        store.set_status(app_id, AppStatus.BLUEPRINTED)
        return result

    try:
        return _apply_and_wait(app_id, result, tf_dir)
    except terraform.TerraformError as exc:
        return _fail(result, app_id, exc.step, str(exc))


def retry(app_id: str) -> BlueprintResult:
    """T3-B-9: fix & retry. Re-map (picks up the bad_wave flag being cleared)
    and apply with -replace so user_data actually takes effect."""
    apps = {a.app_id: a for a in store.get_apps()}
    app = apps[app_id]
    result = build(app)
    tf_dir = Path(result.tf_dir)
    try:
        terraform.init(app_id, tf_dir, backend=True)
        validate_out = terraform.validate(app_id, tf_dir)
        result = result.model_copy(update={"validate_ok": bool(validate_out.get("valid"))})
        return _apply_and_wait(app_id, result, tf_dir, replace=True)
    except terraform.TerraformError as exc:
        return _fail(result, app_id, exc.step, str(exc))


def dry_run_synthetic(batch: int = DRY_RUN_BATCH) -> int:
    """T3-B-10: map -> validate -> render(no write) -> diff for every
    synthetic app already in the store. 1,000 apps in well under 30s: the
    bad_wave flag is read once (not once per app), and both the blueprint
    rows and the status change go to the store in one batched write each,
    the same trick Discovery uses for its 1,000-app run."""
    apps = store.get_apps(source=Source.SYNTHETIC.value)
    bad_wave_apps = {k for k, v in json.loads(store.get_flag("bad_wave") or "{}").items() if v}

    results = [build(app, bad_wave=app.app_id in bad_wave_apps) for app in apps]
    store.save_blueprints(results)
    store.upsert_apps([a.model_copy(update={"status": AppStatus.BLUEPRINTED}) for a in apps])

    ids = [a.app_id for a in apps]
    events.emit_batch(
        AGENT, [(None, EventType.BLUEPRINT_DRY_RUN, {"app_ids": ids[i:i + batch]}) for i in range(0, len(ids), batch)]
    )
    return len(ids)
