"""The LLM-assisted golden-inputs mapper (T3-B-3).

Same status as Track 2's borderline-tiering hook (agents/discovery/tiering.py
`_llm_tier`): the tool schema and the fallback wiring live here and
`agents.blueprint.run` calls them unconditionally; `_llm_available()` is true
once LLM_BACKEND is `bedrock`/`anthropic`/`mock` (agents/common/llm.py).
`LLM_BACKEND=off` (the default) must produce a usable, schema-valid result on
its own — that's the demo safety net.
"""

from __future__ import annotations

import os

from agents.blueprint import mapper_rules, schema
from agents.common.models import AppRecord, Gap, GoldenInputs

SET_GOLDEN_INPUTS = {
    "name": "set_golden_inputs",
    "description": "Submit the golden_app Terraform inputs mapped from this legacy app.",
    "input_schema": {
        "type": "object",
        "properties": {
            "port": {"type": "integer"},
            "instance_type": {"type": "string", "enum": sorted(schema.ALLOWED_INSTANCE_TYPES)},
            "env": {"type": "object", "additionalProperties": {"type": "string"}},
            "tags": {"type": "object", "additionalProperties": {"type": "string"}},
            "gaps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"field": {"type": "string"}, "note": {"type": "string"}},
                    "required": ["field", "note"],
                },
            },
        },
        "required": ["port", "instance_type", "env", "tags"],
    },
}

FLAG_GAP = {
    "name": "flag_gap",
    "description": "Record one field that could not be determined from the legacy record.",
    "input_schema": {
        "type": "object",
        "properties": {"field": {"type": "string"}, "note": {"type": "string"}},
        "required": ["field", "note"],
    },
}

LOOKUP_TARGET_ENDPOINT = {
    "name": "lookup_target_endpoint",
    "description": "Return the target-side URL (through the edge ALB) for a dependency app_id.",
    "input_schema": {"type": "object", "properties": {"app_id": {"type": "string"}}, "required": ["app_id"]},
}

TOOLS = [SET_GOLDEN_INPUTS, FLAG_GAP, LOOKUP_TARGET_ENDPOINT]
# Fields the model decides; a gap on anything else (port, env) is noise.
GAP_FIELDS = {"instance_type", *schema.REQUIRED_TAGS}

SYSTEM = (
    "You map one legacy app record onto the golden_app Terraform module's inputs. "
    "You get a deterministic rules mapping to start from: keep its port and env exactly, "
    "never put a legacy IP literal anywhere. Choose instance_type from the allowed values, "
    "fill the owner, cost-center and data-class tags from whatever the legacy record implies "
    "(keep the rules value when nothing better is implied — never leave a tag empty), "
    "and list every value you had to default or guess in gaps. Call set_golden_inputs once."
)


def _llm_available() -> bool:
    if os.getenv("LLM_BACKEND", "off") in ("off", ""):
        return False
    try:
        from agents.common import llm  # noqa: F401  (Track 4, T4-L-1)
    except ImportError:
        return False
    return True


def _llm_map(app: AppRecord, rules: GoldenInputs) -> tuple[GoldenInputs, list[Gap]]:
    """Retry once on a validation error, then let the caller fall back to rules.

    The model starts from the rules mapping and may change instance_type, tags
    and gaps. `port` and `env` stay pinned to the rules values: the model never
    sees the ALB DNS name or the provider paths (call_tool is single-shot, so
    lookup_target_endpoint isn't wired), and an invented UPSTREAM_URL or port
    would pass validation yet break the app on a real apply."""
    from agents.common import events, llm

    user = (f"Legacy record:\n{app.model_dump_json()}\n\n"
            f"Rules mapping (port and env are fixed; improve instance_type, tags and gaps):\n"
            f"{rules.model_dump_json(exclude={'name', 'runtime'})}")
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            out = dict(llm.call_tool(SYSTEM, user, SET_GOLDEN_INPUTS))
            gaps = [g for g in (Gap.model_validate(g) for g in out.pop("gaps", [])) if g.field in GAP_FIELDS]
            # Only the rules' tag keys (the required three) — models like to add
            # `cost_center` duplicates, which would become real AWS tags. A tag
            # left out or blank keeps the rules default (already a flagged gap).
            said = {k.replace("_", "-"): v for k, v in (out.get("tags") or {}).items() if v}
            tags = {k: said.get(k) or v for k, v in rules.tags.items()}
            out.update(port=rules.port, env=dict(rules.env), tags=tags)
            inputs = GoldenInputs(name=app.app_id, runtime=rules.runtime, **out)
            schema.validate(inputs)
            return inputs, gaps
        except Exception as exc:  # noqa: BLE001 - any failure means "fall back to rules"
            last_error = exc
    events.emit("blueprint", app.app_id, "LLM_FALLBACK", {"reason": f"mapper failed twice: {last_error}"})
    raise RuntimeError("llm mapper failed") from last_error


def map_app(app: AppRecord) -> tuple[GoldenInputs, list[Gap], bool]:
    """Returns (inputs, gaps, used_llm). Always safe to call with LLM_BACKEND=off."""
    rules_inputs, rules_gaps = mapper_rules.map_app(app)
    if not _llm_available():
        return rules_inputs, rules_gaps, False
    try:
        inputs, gaps = _llm_map(app, rules_inputs)
        return inputs, gaps, True
    except Exception:  # noqa: BLE001 - LLM_FALLBACK already emitted in _llm_map
        return rules_inputs, rules_gaps, False
