"""The LLM-assisted golden-inputs mapper (T3-B-3).

Same status as Track 2's borderline-tiering hook (agents/discovery/tiering.py
`_llm_tier`): the tool schema and the fallback wiring live here and
`agents.blueprint.run` calls them unconditionally, but `_llm_available()` is
always False until Track 4 ships `agents/common/llm.py` (T4-L-1), so this is
untested beyond the fallback path. `LLM_BACKEND=off` (the default) must
produce a usable, schema-valid result on its own — that's the demo safety net.
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

SYSTEM = (
    "You map one legacy app record onto the golden_app Terraform module's inputs. "
    "Use lookup_target_endpoint to translate a dependency app_id into its target-side URL "
    "(UPSTREAM_URL + REQUIRE_UPSTREAM=1). Never leave a legacy IP literal in an env value. "
    "Call flag_gap for anything you couldn't determine and had to default, "
    "then call set_golden_inputs exactly once."
)


def _llm_available() -> bool:
    if os.getenv("LLM_BACKEND", "off") in ("off", ""):
        return False
    try:
        from agents.common import llm  # noqa: F401  (Track 4, T4-L-1)
    except ImportError:
        return False
    return True


def _llm_map(app: AppRecord, runtime: str) -> tuple[GoldenInputs, list[Gap]]:
    """Retry once on a validation error, then let the caller fall back to rules."""
    from agents.common import events, llm

    user = app.model_dump_json()
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            out = dict(llm.call_tool(SYSTEM, user, SET_GOLDEN_INPUTS))
            gaps = [Gap.model_validate(g) for g in out.pop("gaps", [])]
            inputs = GoldenInputs(name=app.app_id, runtime=runtime, **out)
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
        inputs, gaps = _llm_map(app, rules_inputs.runtime)
        return inputs, gaps, True
    except Exception:  # noqa: BLE001 - LLM_FALLBACK already emitted in _llm_map
        return rules_inputs, rules_gaps, False
