"""The LLM_BACKEND=off mapper (T3-B-2): AppRecord -> GoldenInputs, no LLM.

Wiring facts (ALB DNS name, a provider's path prefix) come from
target_outputs.json, the same source the Terraform template uses — never
from the legacy record. This is what actually rewrites a HARDCODED_IP finding:
the provider is resolved through Discovery's `depends_on` edge, not by
re-parsing the IP out of the legacy env value.
"""

from __future__ import annotations

from agents.common import aws
from agents.common.models import AppRecord, Gap, GoldenInputs

ALLOWED_INSTANCE_TYPES = {"t3.micro", "t3.small"}
DEFAULT_INSTANCE_TYPE = "t3.micro"
DEFAULT_PORT = 8080
DEFAULTED_TAGS = {
    "owner": "unknown-team",
    "cost-center": "unknown",
    "data-class": "internal",
}


def path_prefix_for(app_id: str) -> str:
    """The provider's ALB path prefix, from app_routes; falls back to the
    naming convention (T3-B-4) for an app with no real route (synthetic, or
    not yet applied)."""
    route = aws.target_outputs().get("app_routes", {}).get(app_id)
    if route:
        if route.get("path_prefix"):
            return route["path_prefix"]
        if route.get("listener_port"):
            return ""  # dedicated listener (e.g. app-juice-shop), no path prefix
    return "/" + app_id.removeprefix("app-")


def runtime_for(app_id: str) -> str:
    route = aws.target_outputs().get("app_routes", {}).get(app_id)
    return route["runtime"] if route and route.get("runtime") else "demo-server"


def _alb_dns_name() -> str:
    try:
        return aws.target_outputs()["alb_dns_name"]
    except (KeyError, FileNotFoundError):
        return "<alb_dns_name>"


def map_app(app: AppRecord) -> tuple[GoldenInputs, list[Gap]]:
    gaps: list[Gap] = []

    instance_type = app.runtime.instance_type
    if instance_type not in ALLOWED_INSTANCE_TYPES:
        note = f"legacy type {instance_type!r} not allowlisted; defaulted" if instance_type else "not found in legacy; defaulted"
        gaps.append(Gap(field="instance_type", note=note))
        instance_type = DEFAULT_INSTANCE_TYPE

    port = app.runtime.port
    if port is None:
        gaps.append(Gap(field="port", note="not found in legacy; defaulted"))
        port = DEFAULT_PORT

    env: dict[str, str] = {}
    if app.depends_on:
        provider = sorted(app.depends_on)[0]
        env["UPSTREAM_URL"] = f"http://{_alb_dns_name()}{path_prefix_for(provider)}/"
        env["REQUIRE_UPSTREAM"] = "1"

    tags: dict[str, str] = {}
    for tag, default in DEFAULTED_TAGS.items():
        value = app.tags.get(tag)
        if value:
            tags[tag] = value
        else:
            tags[tag] = default
            gaps.append(Gap(field=tag, note="not found in legacy; defaulted"))

    inputs = GoldenInputs(
        name=app.app_id,
        port=port,
        instance_type=instance_type,
        env=env,
        tags=tags,
        runtime=runtime_for(app.app_id),
    )
    return inputs, gaps
