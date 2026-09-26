# Read docs/ARCHITECTURE.md — the golden_app Terraform module section and the finding codes table. Read docs/FLOW.md section 5 (Blueprint/IaC sequence). Read agents/common/models.py for BlueprintResult schema. Read fixtures/apps.json. Build:

agents/blueprint/golden_schema.py — GoldenInputs Pydantic model:
Fields: name (str), port (int, 1024-65535), instance_type (str, default t3.micro), env (dict[str,str], default {}), tags (GoldenTags — nested model with owner:str, cost_center:str, data_class:str).
Add validator: tags must not be empty strings. env values must not be raw IP addresses (otherwise flag HARDCODED_IP is not fixed).

agents/blueprint/mapper.py — LLMMapper class:
Tools for the LLM:
  set_golden_inputs(inputs: dict) → validates against GoldenInputs, stores result. Returns {"ok":true} or {"error":"validation message"}.
  flag_gap(field: str, note: str) → records a gap that couldn't be auto-mapped.

Rule-based fallback (used when LLM_BACKEND=off):
  name → app_record.app_id
  port → app_record.runtime.port
  instance_type → same as legacy (or t3.micro if unknown)
  env → copy app_record.config.env as-is, EXCEPT replace any raw IP with a placeholder (if app-pricing IP, replace with env var reference).
  tags.owner → app_record.owner or "unknown"
  tags.cost_center → app_record.tags.get("cost-center","unknown")
  tags.data_class → app_record.tags.get("data-class","internal")

LLM prompt (for LLM_BACKEND=bedrock): "You are mapping legacy EC2 config to a hardened golden module. Legacy app: {app_record_json}. Golden module variables schema: {GoldenInputs.schema_json()}. Map legacy config to golden inputs. For any IP address in env vars, use a service-name reference like http://// instead. If you can't determine a field, call flag_gap. Then call set_golden_inputs with your final mapping."

agents/blueprint/diff.py — build_diff(app_record: AppRecord, golden_inputs: GoldenInputs) -> dict:
For each finding in app_record.findings, produce an annotation: {finding, before_description, after_description, fix}. The mapping:
  SG_OPEN_SSH → before: "SSH port 22 open to 0.0.0.0/0", after: "SSH removed — SSM Session Manager only", fix: "SSH removed; SSM Session Manager"
  SG_OPEN_APP → before: "App port open to 0.0.0.0/0", after: "Ingress from ALB only (port {port})", fix: "Restricted to ALB SG ingress"
  EBS_UNENCRYPTED → before: "Root volume unencrypted", after: "KMS-encrypted gp3", fix: "KMS encryption enabled"
  IMDSV1 → before: "IMDSv1 allowed (metadata without token)", after: "IMDSv2 required", fix: "HttpTokens=required"
  OLD_AMI → before: "Amazon Linux 2 (legacy)", after: "Amazon Linux 2023 (current)", fix: "Upgraded to AL2023"
  NO_VPC_SEGMENTATION → before: "All subnets public (no private subnet tier)", after: "Private subnet only (no public IP)", fix: "Private subnet deployment"
  PUBLIC_IP → before: "Public IP assigned", after: "No public IP, private subnet", fix: "Removed public IP"
  MISSING_TAGS → before: "Missing owner/cost-center/data-class tags", after: "All required tags set", fix: "Tags populated from app metadata"
  HARDCODED_IP → before: "PRICING_URL=http://10.10.1.20:8080 (hardcoded IP)", after: "PRICING_URL=http:///pricing/ (ALB route)", fix: "Replaced with ALB DNS name"
Return {before_summary, after_summary, annotations: list[dict]}.

---

**Status:** active  **Date:** 2026-09-26

---

### 👤 User

Read docs/ARCHITECTURE.md — the golden_app Terraform module section and the finding codes table. Read docs/FLOW.md section 5 (Blueprint/IaC sequence). Read agents/common/models.py for BlueprintResult schema. Read fixtures/apps.json. Build:

agents/blueprint/golden_schema.py — GoldenInputs Pydantic model:
Fields: name (str), port (int, 1024-65535), instance_type (str, default t3.micro), env (dict[str,str], default {}), tags (GoldenTags — nested model with owner:str, cost_center:str, data_class:str).
Add validator: tags must not be empty strings. env values must not be raw IP addresses (otherwise flag HARDCODED_IP is not fixed).

agents/blueprint/mapper.py — LLMMapper class:
Tools for the LLM:
  set_golden_inputs(inputs: dict) → validates against GoldenInputs, stores result. Returns {"ok":true} or {"error":"validation message"}.
  flag_gap(field: str, note: str) → records a gap that couldn't be auto-mapped.

Rule-based fallback (used when LLM_BACKEND=off):
  name → app_record.app_id
  port → app_record.runtime.port
  instance_type → same as legacy (or t3.micro if unknown)
  env → copy app_record.config.env as-is, EXCEPT replace any raw IP with a placeholder (if app-pricing IP, replace with env var reference).
  tags.owner → app_record.owner or "unknown"
  tags.cost_center → app_record.tags.get("cost-center","unknown")
  tags.data_class → app_record.tags.get("data-class","internal")

LLM prompt (for LLM_BACKEND=bedrock): "You are mapping legacy EC2 config to a hardened golden module. Legacy app: {app_record_json}. Golden module variables schema: {GoldenInputs.schema_json()}. Map legacy config to golden inputs. For any IP address in env vars, use a service-name reference like http://// instead. If you can't determine a field, call flag_gap. Then call set_golden_inputs with your final mapping."

agents/blueprint/diff.py — build_diff(app_record: AppRecord, golden_inputs: GoldenInputs) -> dict:
For each finding in app_record.findings, produce an annotation: {finding, before_description, after_description, fix}. The mapping:
  SG_OPEN_SSH → before: "SSH port 22 open to 0.0.0.0/0", after: "SSH removed — SSM Session Manager only", fix: "SSH removed; SSM Session Manager"
  SG_OPEN_APP → before: "App port open to 0.0.0.0/0", after: "Ingress from ALB only (port {port})", fix: "Restricted to ALB SG ingress"
  EBS_UNENCRYPTED → before: "Root volume unencrypted", after: "KMS-encrypted gp3", fix: "KMS encryption enabled"
  IMDSV1 → before: "IMDSv1 allowed (metadata without token)", after: "IMDSv2 required", fix: "HttpTokens=required"
  OLD_AMI → before: "Amazon Linux 2 (legacy)", after: "Amazon Linux 2023 (current)", fix: "Upgraded to AL2023"
  NO_VPC_SEGMENTATION → before: "All subnets public (no private subnet tier)", after: "Private subnet only (no public IP)", fix: "Private subnet deployment"
  PUBLIC_IP → before: "Public IP assigned", after: "No public IP, private subnet", fix: "Removed public IP"
  MISSING_TAGS → before: "Missing owner/cost-center/data-class tags", after: "All required tags set", fix: "Tags populated from app metadata"
  HARDCODED_IP → before: "PRICING_URL=http://10.10.1.20:8080 (hardcoded IP)", after: "PRICING_URL=http:///pricing/ (ALB route)", fix: "Replaced with ALB DNS name"
Return {before_summary, after_summary, annotations: list[dict]}.

---

### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[-] Read docs/ARCHITECTURE.md (golden_app module section + finding codes table)
[ ] Read docs/FLOW.md section 5 (Blueprint/IaC sequence)
[ ] Read agents/common/models.py for BlueprintResult schema
[ ] Read fixtures/apps.json
[ ] Build agents/blueprint/golden_schema.py
[ ] Build agents/blueprint/mapper.py
[ ] Build agents/blueprint/diff.py


### 🤖 Assistant

> 🔧 called: read_file, read_file, read_file, read_file



> 🔧 **read_file** — agents/common/models.py

> 🔧 **read_file** — fixtures/apps.json

> 🔧 **read_file** — docs/FLOW.md

> 🔧 **read_file** — docs/ARCHITECTURE.md

### 🤖 Assistant

> 🔧 called: list_files



> 🔧 **list_files** — .

### 🤖 Assistant

> 🔧 called: list_files, list_files



> 🔧 **list_files** — docs

> 🔧 **list_files** — agents

### 🤖 Assistant

> 🔧 called: read_file



> 🔧 **read_file** — docs/CONTRACTS.md

### 🤖 Assistant

> 🔧 called: update_todo_list

Now I have everything I need. Let me check if `agents/common/models.py` and `agents/blueprint/` exist anywhere:

> 🔧 **update_todo_list** — 
[x] Read docs/ARCHITECTURE.md (golden_app module section + finding codes table)
[x] Read docs/FLOW.md section 5 (Blueprint/IaC sequence)
[x] Read docs/CONTRACTS.md for BlueprintResult schema (models.py not yet created)
[x] Read fixtures/apps.json (not yet created)
[-] Build agents/common/models.py (must be created first — blueprint files depend on it)
[ ] Build agents/blueprint/golden_schema.py
[ ] Build agents/blueprint/mapper.py
[ ] Build agents/blueprint/diff.py


### 🤖 Assistant

> 🔧 called: write_file

Now I'll build all four files. `agents/common/models.py` is needed by the blueprint files, so I'll write it first, then the three blueprint files.

> 🔧 **write_file** — agents/common/models.py

### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[x] Read docs/ARCHITECTURE.md (golden_app module section + finding codes table)
[x] Read docs/FLOW.md section 5 (Blueprint/IaC sequence)
[x] Read docs/CONTRACTS.md for BlueprintResult schema (models.py not yet created)
[x] Read fixtures/apps.json (not yet created)
[x] Build agents/common/models.py (must be created first — blueprint files depend on it)
[-] Build agents/blueprint/golden_schema.py
[ ] Build agents/blueprint/mapper.py
[ ] Build agents/blueprint/diff.py


### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — """
GoldenInputs — Pydantic v2 model for the golden_app Terraform module variables.

Validates inputs before they are rendered into main.tf.
See docs/ARCHITECTURE.md §Target environment for the golden module description.
"""
from __future__ import annotations

import re
from typing import Annotated

from pydantic import BaseModel, Field, field_validator, model_validator

# Regex that matches a bare IPv4 address anywhere in a value string.
_IP_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")


class GoldenTags(BaseModel):
    """Mandatory resource tags required by the golden_app module."""

    owner: str
    cost_center: str
    data_class: str

    @model_validator(mode="after")
    def _no_empty_strings(self) -> "GoldenTags":
        for field_name, value in self.__dict__.items():
            if isinstance(value, str) and value.strip() == "":
                raise ValueError(
                    f"GoldenTags.{field_name} must not be an empty string"
                )
        return self


class GoldenInputs(BaseModel):
    """
    Variables accepted by modules/golden_app.

    Validated before being written to generated/<app>/main.tf.
    """

    name: str
    port: Annotated[int, Field(ge=1024, le=65535)]
    instance_type: str = "t3.micro"
    env: dict[str, str] = Field(default_factory=dict)
    tags: GoldenTags

    @field_validator("env")
    @classmethod
    def _env_no_hardcoded_ips(cls, env: dict[str, str]) -> dict[str, str]:
        """
        Reject env values that contain a raw IPv4 address.

        A raw IP in an env var means HARDCODED_IP was *not* fixed before the
        inputs reached the golden module.  The mapper must replace IPs with
        service-name references (e.g. http://<alb_dns_name>/pricing/) before
        calling set_golden_inputs.
        """
        bad = {k: v for k, v in env.items() if _IP_RE.search(v)}
        if bad:
            keys = ", ".join(bad.keys())
            raise ValueError(
                f"env values contain raw IP addresses (HARDCODED_IP not fixed): {keys}"
            )
        return env


### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[x] Read docs/ARCHITECTURE.md (golden_app module section + finding codes table)
[x] Read docs/FLOW.md section 5 (Blueprint/IaC sequence)
[x] Read docs/CONTRACTS.md for BlueprintResult schema (models.py not yet created)
[x] Read fixtures/apps.json (not yet created)
[x] Build agents/common/models.py (must be created first — blueprint files depend on it)
[x] Build agents/blueprint/golden_schema.py
[-] Build agents/blueprint/mapper.py
[ ] Build agents/blueprint/diff.py


### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — """
LLMMapper — maps a legacy AppRecord to GoldenInputs.

Two modes controlled by the LLM_BACKEND env-var:
  LLM_BACKEND=bedrock  → send a tool-calling prompt to Claude via AnthropicBedrock
  LLM_BACKEND=off      → rule-based fallback (deterministic, no LLM call)

See docs/FLOW.md §5 for the Blueprint/IaC sequence diagram.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

from pydantic import ValidationError

from agents.common.models import AppRecord
from agents.blueprint.golden_schema import GoldenInputs, GoldenTags

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_IP_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")

# Account B VPC CIDR prefix — any 10.10.x.x address is in the legacy VPC.
# During rule-based mapping we replace such IPs with a placeholder reference.
_LEGACY_IP_PREFIX = "10.10."


def _replace_ips(env: dict[str, str]) -> dict[str, str]:
    """
    Replace raw IPv4 addresses in env values with ALB service-name references.

    For each key/value where the value contains a legacy 10.10.x.x IP, we
    substitute a placeholder of the form ``http://<service-name-placeholder>/``
    so that the GoldenInputs validator passes.  A real LLM call produces the
    proper ALB DNS name; the rule-based path uses a safe placeholder.
    """
    out: dict[str, str] = {}
    for key, value in env.items():
        def _sub(m: re.Match[str]) -> str:
            ip = m.group(0)
            if ip.startswith(_LEGACY_IP_PREFIX):
                # Derive a human-readable service slug from the env-var name.
                # e.g. PRICING_URL → "pricing", CATALOG_URL → "catalog"
                slug = key.lower().replace("_url", "").replace("_", "-")
                return f"<alb_dns_name>/{slug}/"
            return ip  # non-legacy IP: leave for the LLM to fix

        out[key] = _IP_RE.sub(_sub, value)
    return out


# ---------------------------------------------------------------------------
# LLMMapper
# ---------------------------------------------------------------------------

class LLMMapper:
    """
    Maps a legacy AppRecord to validated GoldenInputs.

    Usage::

        mapper = LLMMapper(app_record)
        golden_inputs = mapper.run()   # returns GoldenInputs or raises
        gaps = mapper.gaps             # list[{"field": str, "note": str}]
    """

    def __init__(self, app_record: AppRecord) -> None:
        self._app = app_record
        self._inputs: GoldenInputs | None = None
        self.gaps: list[dict[str, str]] = []

    # ------------------------------------------------------------------
    # Tool implementations (called by the LLM or directly by the fallback)
    # ------------------------------------------------------------------

    def set_golden_inputs(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """
        Validate *inputs* against GoldenInputs and store the result.

        Returns ``{"ok": true}`` on success or ``{"error": "<message>"}`` on
        validation failure so the LLM can correct and retry.
        """
        try:
            self._inputs = GoldenInputs.model_validate(inputs)
            return {"ok": True}
        except ValidationError as exc:
            # Return a concise error string; the LLM will read it and retry.
            errors = "; ".join(
                f"{'.'.join(str(loc) for loc in e['loc'])}: {e['msg']}"
                for e in exc.errors()
            )
            return {"error": errors}

    def flag_gap(self, field: str, note: str) -> dict[str, str]:
        """
        Record a field that the mapper could not automatically determine.

        The gap is stored in ``self.gaps`` and will be surfaced in
        BlueprintResult.gaps so a human reviewer can follow up.
        """
        self.gaps.append({"field": field, "note": note})
        return {"recorded": True, "field": field}

    # ------------------------------------------------------------------
    # Rule-based fallback
    # ------------------------------------------------------------------

    def _rule_based(self) -> None:
        app = self._app

        # name
        name: str = app.app_id

        # port
        port: int = app.runtime.port

        # instance_type — preserve legacy type or fall back to t3.micro
        instance_type: str = app.runtime.instance_type or "t3.micro"

        # env — copy as-is, then replace any raw IPs with service references
        env: dict[str, str] = dict(app.config.env)
        env = _replace_ips(env)

        # tags
        owner: str = app.owner or "unknown"
        cost_center: str = app.tags.get("cost-center", "unknown")
        data_class: str = app.tags.get("data-class", "internal")

        # Flag gaps for fields we defaulted
        if not app.owner:
            self.flag_gap("tags.owner", "owner not set in legacy app record; defaulted to 'unknown'")
        if "cost-center" not in app.tags:
            self.flag_gap("tags.cost_center", "cost-center tag not found in legacy; defaulted to 'unknown'")
        if "data-class" not in app.tags:
            self.flag_gap("tags.data_class", "data-class tag not found in legacy; defaulted to 'internal'")

        result = self.set_golden_inputs(
            {
                "name": name,
                "port": port,
                "instance_type": instance_type,
                "env": env,
                "tags": {
                    "owner": owner,
                    "cost_center": cost_center,
                    "data_class": data_class,
                },
            }
        )
        if "error" in result:
            raise ValueError(f"Rule-based mapping produced invalid inputs: {result['error']}")

    # ------------------------------------------------------------------
    # LLM path (Bedrock / Claude)
    # ------------------------------------------------------------------

    def _llm_based(self) -> None:
        """Call Claude via AnthropicBedrock with tool-calling."""
        try:
            import anthropic  # type: ignore[import]
        except ImportError as exc:
            raise RuntimeError(
                "anthropic package not installed; set LLM_BACKEND=off to use rule-based mapping"
            ) from exc

        client = anthropic.AnthropicBedrock()

        tools: list[dict[str, Any]] = [
            {
                "name": "set_golden_inputs",
                "description": (
                    "Validate and store the final golden module variable mapping. "
                    "Call this once you have determined all fields. "
                    "Returns {\"ok\": true} on success or {\"error\": \"...\"} if validation fails."
                ),
                "input_schema": GoldenInputs.model_json_schema(),
            },
            {
                "name": "flag_gap",
                "description": (
                    "Record a field you could not determine from the legacy config. "
                    "The gap will be surfaced to a human reviewer."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string", "description": "Dotted field name, e.g. 'tags.cost_center'"},
                        "note": {"type": "string", "description": "Why you couldn't determine the value"},
                    },
                    "required": ["field", "note"],
                },
            },
        ]

        prompt = (
            "You are mapping a legacy EC2 configuration to a hardened golden module.\n\n"
            f"Legacy app record:\n{self._app.model_dump_json(indent=2)}\n\n"
            f"Golden module variables schema:\n{json.dumps(GoldenInputs.model_json_schema(), indent=2)}\n\n"
            "Map the legacy config to the golden inputs following these rules:\n"
            "- For any IP address in env vars, use a service-name reference like "
            "http://<alb_dns_name>/<service>/ instead of the raw IP.\n"
            "- If you cannot determine a field value, call flag_gap before calling set_golden_inputs.\n"
            "- Call set_golden_inputs with your final mapping. If it returns an error, fix the "
            "inputs and call it again."
        )

        messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]

        # Agentic tool-calling loop — continue until the LLM stops calling tools
        # or until set_golden_inputs succeeds.
        for _ in range(10):  # safety limit
            response = client.messages.create(
                model="anthropic.claude-3-5-sonnet-20241022-v2:0",
                max_tokens=4096,
                tools=tools,
                messages=messages,
            )

            # Append assistant turn
            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "end_turn":
                break

            if response.stop_reason != "tool_use":
                break

            # Process tool calls
            tool_results: list[dict[str, Any]] = []
            for block in response.content:
                if block.type != "tool_use":
                    continue

                if block.name == "set_golden_inputs":
                    result = self.set_golden_inputs(block.input)
                elif block.name == "flag_gap":
                    result = self.flag_gap(**block.input)
                else:
                    result = {"error": f"unknown tool: {block.name}"}

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result),
                    }
                )

                # If set_golden_inputs succeeded we can stop
                if block.name == "set_golden_inputs" and result.get("ok"):
                    messages.append({"role": "user", "content": tool_results})
                    return

            messages.append({"role": "user", "content": tool_results})

        if self._inputs is None:
            raise RuntimeError("LLM did not produce valid golden inputs after tool-calling loop")

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def run(self) -> GoldenInputs:
        """
        Map the app record to GoldenInputs.

        Chooses the LLM path when ``LLM_BACKEND=bedrock``, otherwise falls
        back to the deterministic rule-based mapper.
        """
        backend = os.environ.get("LLM_BACKEND", "off").lower()

        if backend == "bedrock":
            self._llm_based()
        else:
            self._rule_based()

        if self._inputs is None:
            raise RuntimeError("Mapper produced no inputs")
        return self._inputs


### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[x] Read docs/ARCHITECTURE.md (golden_app module section + finding codes table)
[x] Read docs/FLOW.md section 5 (Blueprint/IaC sequence)
[x] Read docs/CONTRACTS.md for BlueprintResult schema (models.py not yet created)
[x] Read fixtures/apps.json (not yet created)
[x] Build agents/common/models.py (must be created first — blueprint files depend on it)
[x] Build agents/blueprint/golden_schema.py
[x] Build agents/blueprint/mapper.py
[-] Build agents/blueprint/diff.py


### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — """
build_diff — produce a structured before/after diff for a single app migration.

For each finding in AppRecord.findings, an annotation is generated that
describes what the legacy config looked like, what the golden module does
instead, and a short fix label.

See docs/ARCHITECTURE.md §Legacy environment for the finding code table.
"""
from __future__ import annotations

from agents.common.models import AppRecord
from agents.blueprint.golden_schema import GoldenInputs

# ---------------------------------------------------------------------------
# Per-finding annotation templates
# ---------------------------------------------------------------------------
# Each entry: (before_description, after_description_template, fix_label)
# Templates may reference {port} from the GoldenInputs.

_ANNOTATIONS: dict[str, tuple[str, str, str]] = {
    "SG_OPEN_SSH": (
        "SSH port 22 open to 0.0.0.0/0",
        "SSH removed — SSM Session Manager only",
        "SSH removed; SSM Session Manager",
    ),
    "SG_OPEN_APP": (
        "App port open to 0.0.0.0/0",
        "Ingress from ALB only (port {port})",
        "Restricted to ALB SG ingress",
    ),
    "EBS_UNENCRYPTED": (
        "Root volume unencrypted",
        "KMS-encrypted gp3",
        "KMS encryption enabled",
    ),
    "IMDSV1": (
        "IMDSv1 allowed (metadata without token)",
        "IMDSv2 required",
        "HttpTokens=required",
    ),
    "OLD_AMI": (
        "Amazon Linux 2 (legacy)",
        "Amazon Linux 2023 (current)",
        "Upgraded to AL2023",
    ),
    "NO_VPC_SEGMENTATION": (
        "All subnets public (no private subnet tier)",
        "Private subnet only (no public IP)",
        "Private subnet deployment",
    ),
    "PUBLIC_IP": (
        "Public IP assigned",
        "No public IP, private subnet",
        "Removed public IP",
    ),
    "MISSING_TAGS": (
        "Missing owner/cost-center/data-class tags",
        "All required tags set",
        "Tags populated from app metadata",
    ),
    "HARDCODED_IP": (
        "PRICING_URL=http://10.10.1.20:8080 (hardcoded IP)",
        "PRICING_URL=http://<alb_dns_name>/pricing/ (ALB route)",
        "Replaced with ALB DNS name",
    ),
}


# ---------------------------------------------------------------------------
# Public function
# ---------------------------------------------------------------------------

def build_diff(app_record: AppRecord, golden_inputs: GoldenInputs) -> dict:
    """
    Build a before/after diff dict for *app_record* given its *golden_inputs*.

    Returns::

        {
            "before_summary": str,
            "after_summary": str,
            "annotations": [
                {
                    "finding": str,
                    "before_description": str,
                    "after_description": str,
                    "fix": str,
                },
                ...
            ],
        }

    Only findings present in ``app_record.findings`` produce annotations.
    Unknown finding codes are included with generic descriptions so the diff
    is never silently incomplete.
    """
    annotations: list[dict[str, str]] = []

    for finding in app_record.findings:
        if finding in _ANNOTATIONS:
            before_tmpl, after_tmpl, fix = _ANNOTATIONS[finding]
            annotations.append(
                {
                    "finding": finding,
                    "before_description": before_tmpl.format(port=golden_inputs.port),
                    "after_description": after_tmpl.format(port=golden_inputs.port),
                    "fix": fix,
                }
            )
        else:
            # Unknown finding — surface it rather than silently ignore.
            annotations.append(
                {
                    "finding": finding,
                    "before_description": f"{finding}: legacy misconfiguration",
                    "after_description": f"{finding}: remediated by golden module",
                    "fix": "Remediated",
                }
            )

    finding_count = len(annotations)
    finding_labels = ", ".join(a["finding"] for a in annotations) if annotations else "none"

    before_summary = (
        f"{app_record.name or app_record.app_id} — legacy EC2 in public subnet with "
        f"{finding_count} finding(s): {finding_labels}."
    )
    after_summary = (
        f"{golden_inputs.name} — golden_app module: private subnet, KMS-encrypted EBS, "
        f"IMDSv2, SSM access, current AMI, ALB-only ingress on port {golden_inputs.port}, "
        f"mandatory tags set."
    )

    return {
        "before_summary": before_summary,
        "after_summary": after_summary,
        "annotations": annotations,
    }


### 🤖 Assistant

> 🔧 called: execute_command

Now let's add `__init__.py` files so the packages import cleanly, then run a quick syntax check:

> 🔧 **execute_command** — New-Item -Path agents\common\__init__.py -ItemType File -Force | Out-Null; New-Item -Path agents\blueprint\__init__.py -ItemType File -Force | Out-Null; Write-Host "init files created"

### 🤖 Assistant

> 🔧 called: execute_command



> 🔧 **execute_command** — python -c "
import sys, json

# Syntax-check all four new files
import py_compile
files = [
    'agents/common/models.py',
    'agents/blueprint/golden_schema.py',
    'agents/blueprint/mapper.py',
    'agents/blueprint/diff.py',
]
for f in files:
    try:
        py_compile.compile(f, doraise=True)
        print(f'OK  {f}')
    except py_compile.PyCompileError as e:
        print(f'ERR {f}: {e}')
        sys.exit(1)
"


### 🤖 Assistant

> 🔧 called: execute_command



> 🔧 **execute_command** — python -c "
import sys
sys.path.insert(0, '.')

# ── Import all three blueprint modules ──────────────────────────────────────
from agents.common.models import AppRecord
from agents.blueprint.golden_schema import GoldenInputs, GoldenTags
from agents.blueprint.mapper import LLMMapper
from agents.blueprint.diff import build_diff

# ── GoldenTags: empty-string rejection ──────────────────────────────────────
try:
    GoldenTags(owner='', cost_center='ops', data_class='internal')
    print('FAIL: empty owner should have raised')
    sys.exit(1)
except Exception as e:
    print(f'PASS empty-tag guard: {e}')

# ── GoldenInputs: hardcoded IP rejection ────────────────────────────────────
try:
    GoldenInputs(
        name='test', port=8080,
        env={'URL': 'http://10.10.1.20:8080'},
        tags=GoldenTags(owner='team', cost_center='ops', data_class='internal'),
    )
    print('FAIL: hardcoded IP should have raised')
    sys.exit(1)
except Exception as e:
    print(f'PASS hardcoded-IP guard: {e}')

# ── GoldenInputs: valid inputs pass ─────────────────────────────────────────
gi = GoldenInputs(
    name='app-orders', port=8080,
    env={'UPSTREAM_URL': 'http://<alb_dns_name>/pricing/'},
    tags=GoldenTags(owner='team-commerce', cost_center='retail', data_class='internal'),
)
print(f'PASS valid GoldenInputs: {gi.model_dump()}')

# ── Port range boundaries ────────────────────────────────────────────────────
try:
    GoldenInputs(
        name='bad', port=80,
        tags=GoldenTags(owner='x', cost_center='y', data_class='z'),
    )
    print('FAIL: port 80 should be rejected')
    sys.exit(1)
except Exception as e:
    print(f'PASS port-range guard (low): {e}')

try:
    GoldenInputs(
        name='bad', port=70000,
        tags=GoldenTags(owner='x', cost_center='y', data_class='z'),
    )
    print('FAIL: port 70000 should be rejected')
    sys.exit(1)
except Exception as e:
    print(f'PASS port-range guard (high): {e}')

# ── Rule-based mapper ────────────────────────────────────────────────────────
import json, os
os.environ['LLM_BACKEND'] = 'off'

raw = {
    'app_id': 'app-orders',
    'source': 'real',
    'name': 'Orders API',
    'owner': 'team-commerce',
    'runtime': {'instance_type': 't3.micro', 'port': 8080},
    'config': {'env': {'PRICING_URL': 'http://10.10.1.40:8080'}},
    'tags': {'depends-on': 'app-pricing'},
    'findings': ['SG_OPEN_SSH', 'HARDCODED_IP', 'MISSING_TAGS'],
}
app = AppRecord.model_validate(raw)
mapper = LLMMapper(app)
result = mapper.run()
print(f'PASS rule-based mapper: {result.model_dump()}')
print(f'     gaps: {mapper.gaps}')
# Confirm IP was replaced
assert '10.10.1.40' not in json.dumps(result.env), 'raw IP leaked into env!'
print('PASS IP replacement in env')

# ── build_diff ───────────────────────────────────────────────────────────────
diff = build_diff(app, result)
assert diff['annotations'], 'expected annotations'
codes = {a['finding'] for a in diff['annotations']}
assert 'SG_OPEN_SSH' in codes
assert 'HARDCODED_IP' in codes
print(f'PASS build_diff: {len(diff[\"annotations\"])} annotations')
for ann in diff['annotations']:
    print(f'  {ann[\"finding\"]}: {ann[\"fix\"]}')

print()
print('All checks passed.')
"


### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — _test_blueprint.py

### 🤖 Assistant

> 🔧 called: execute_command



> 🔧 **execute_command** — python _test_blueprint.py

### 🤖 Assistant

> 🔧 called: execute_command



> 🔧 **execute_command** — pip install pydantic --quiet

### 🤖 Assistant

> 🔧 called: execute_command



> 🔧 **execute_command** — python _test_blueprint.py

### 🤖 Assistant

> 🔧 called: read_file

There's a small issue — the IP substitution regex is including the `:8080` port in the replacement path. Let me fix the `_replace_ips` function in `mapper.py` so the substitution replaces only the IP (not the rest of the URL including the port):

> 🔧 **read_file** — agents/blueprint/mapper.py

### 🤖 Assistant

> 🔧 called: apply_diff

The problem is that `_IP_RE` only matches the IP itself, but the value is `http://10.10.1.40:8080` — the substitution replaces just the IP portion, leaving `http://<alb_dns_name>/pricing//:8080`. The replacement should replace the entire `scheme://ip:port/path` pattern rather than just the IP. Let me fix this with a broader URL pattern:

> 🔧 **apply_diff** — agents/blueprint/mapper.py

### 🤖 Assistant

> 🔧 called: apply_diff



> 🔧 **apply_diff** — agents/blueprint/mapper.py

### 🤖 Assistant

> 🔧 called: execute_command



> 🔧 **execute_command** — python _test_blueprint.py

### 🤖 Assistant

> 🔧 called: execute_command

All checks pass. Clean up the temp test file:

> 🔧 **execute_command** — Remove-Item _test_blueprint.py

### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[x] Read docs/ARCHITECTURE.md (golden_app module section + finding codes table)
[x] Read docs/FLOW.md section 5 (Blueprint/IaC sequence)
[x] Read docs/CONTRACTS.md for BlueprintResult schema (models.py not yet created)
[x] Read fixtures/apps.json (not yet created)
[x] Build agents/common/models.py (must be created first — blueprint files depend on it)
[x] Build agents/blueprint/golden_schema.py
[x] Build agents/blueprint/mapper.py
[x] Build agents/blueprint/diff.py


### 🤖 Assistant

All four files are done and validated. Here's a summary of what was built:

---

## Files created

### [`agents/common/models.py`](agents/common/models.py)
Pydantic v2 models matching the frozen CONTRACTS.md shapes: `AppRecord` (with nested `RuntimeInfo`, `NetworkInfo`, `StorageInfo`, `MetadataInfo`, `ConfigInfo`), `Tiering`, `BlueprintResult`, and `Edge`.

---

### [`agents/blueprint/golden_schema.py`](agents/blueprint/golden_schema.py)

**`GoldenTags`** — nested model with `owner`, `cost_center`, `data_class`; `@model_validator` rejects any empty-string field.

**`GoldenInputs`** — golden_app module variables:
- `name: str`, `port: int` (1024–65535 via `Annotated[int, Field(ge=1024, le=65535)]`), `instance_type: str = "t3.micro"`, `env: dict[str,str] = {}`, `tags: GoldenTags`
- `@field_validator("env")` scans all values with `_IP_RE`; raises if any raw IPv4 address is found (HARDCODED_IP not yet fixed)

---

### [`agents/blueprint/mapper.py`](agents/blueprint/mapper.py)

**`LLMMapper`** — two paths chosen by `LLM_BACKEND` env-var:

| Tool method | Behaviour |
|---|---|
| [`set_golden_inputs(inputs)`](agents/blueprint/mapper.py) | Validates via `GoldenInputs.model_validate`; stores result; returns `{"ok":true}` or `{"error":"..."}` |
| [`flag_gap(field, note)`](agents/blueprint/mapper.py) | Appends to `self.gaps`; returns `{"recorded":true,...}` |

**Rule-based fallback** (`LLM_BACKEND=off`): maps `name→app_id`, `port→runtime.port`, `instance_type→runtime.instance_type`, `env` copied with `_replace_ips()` (full `http://10.10.x.x:port/path` → `http://<alb_dns_name>/slug/` substitution), tags from `owner`/`cost-center`/`data-class` fields with auto-gaps.

**LLM path** (`LLM_BACKEND=bedrock`): sends a tool-calling prompt to Claude (`AnthropicBedrock`) with both tools registered and a JSON-schema payload of `GoldenInputs`; runs an agentic loop until `set_golden_inputs` returns `{"ok":true}`.

---

### [`agents/blueprint/diff.py`](agents/blueprint/diff.py)

**[`build_diff(app_record, golden_inputs) → dict`](agents/blueprint/diff.py)** — iterates `app_record.findings`, looks up each code in `_ANNOTATIONS` (all 9 codes from ARCHITECTURE.md covered), formats `{port}` via `.format(port=golden_inputs.port)`, and returns:

```python
{
  "before_summary": "...",
  "after_summary":  "...",
  "annotations": [{"finding", "before_description", "after_description", "fix"}, ...]
}
```

Unknown finding codes produce a safe generic annotation rather than being silently dropped.

---

### 👤 User

session summary ? where to find the tab

---

### 🤖 Assistant

The **Session Summary** tab lives in the **Bob sidebar**.

Here's how to find it:

1. Look at the **left sidebar** in Bob — it has an icon strip on the far left edge.
2. Click the **clock / history icon** (usually looks like a clock or a document with lines).
3. That opens the **History** panel — your current and past sessions are listed there.
4. Click into the current session and you'll see a **Session Summary** option, or it may auto-generate one when the session ends.

Alternatively:

- At the **top of the chat panel**, click the **session title** (the breadcrumb text, e.g. "Agent") — some Bob versions show a summary dropdown from there.
- Or use the **`...` menu** (three dots) at the top-right of the chat window — "Session Summary" or "Export" is typically in that menu.

---

**What we did in this session** (quick recap if you need it right now):

| File | What it does |
|---|---|
| [`agents/common/models.py`](agents/common/models.py) | Pydantic v2 shared contracts — `AppRecord`, `Tiering`, `BlueprintResult`, `Edge` |
| [`agents/blueprint/golden_schema.py`](agents/blueprint/golden_schema.py) | `GoldenInputs` + `GoldenTags` — validates golden_app module variables, rejects empty tags and hardcoded IPs |
| [`agents/blueprint/mapper.py`](agents/blueprint/mapper.py) | `LLMMapper` — rule-based fallback + Bedrock/Claude tool-calling path to map legacy `AppRecord` → `GoldenInputs` |
| [`agents/blueprint/diff.py`](agents/blueprint/diff.py) | `build_diff()` — produces annotated before/after diff for all 9 finding codes |

===

# 73d9ad8da428dfec192074f77f6b5407

---

**Status:** running  **Date:** 2026-09-26

---

### 👤 User

Read docs/FLOW.md — section 6 (Cutover sequence and gates). This fake ALB harness lets you develop and test the Cutover agent without real AWS. Create agents/cutover/fake_alb/:

legacy_server.py — simple HTTP server on port 8081 (configurable via PORT_LEGACY env):
- GET / → {"served_by":"legacy","status":200,"app":"app-orders"}
- GET /health → {"status":"healthy"}
- If env INJECT_ERRORS=1: randomly return HTTP 500 on 35% of requests to simulate the bad wave (app returns 500s due to missing PRICING_URL).

target_server.py — simple HTTP server on port 8082 (PORT_TARGET env):
- GET / → {"served_by":"target","status":200,"app":"app-orders"}
- GET /health → {"status":"healthy"}
- Never returns errors unless INJECT_TARGET_ERRORS=1.

proxy.py — weighted proxy on port 8080 (PORT_PROXY env):
- Reads LEGACY_WEIGHT and TARGET_WEIGHT from a shared JSON file (fake_alb/weights.json). Defaults: legacy=100, target=0.
- Routes each request: if random() * 100 < LEGACY_WEIGHT → forward to legacy_server, else → forward to target_server. Copies status code and body.
- Tracks last 100 requests in a deque: (timestamp, status_code, latency_ms, served_by).
- GET /weights → current weights
- POST /weights body: {"legacy":N,"target":M} → updates weights.json
- GET /metrics → {error_rate: float (% 5xx in last 100), p95_ms: float, served_by: {legacy:int, target:int}, total: int, window_size: 100}

harness.py — starts all three servers as subprocesses and a watchdog:
- Usage: python harness.py [--inject-errors 0]
- Sets INJECT_ERRORS env var if flag is set.
- Prints URLs for all 3 servers.
- Ctrl+C cleanly stops all servers.

Test: start harness.py, curl localhost:8080/ 10 times, verify responses. Then POST /weights {"legacy":50,"target":50} and verify ~50% come from each. Then set INJECT_ERRORS=1 and verify /metrics shows error_rate > 0.

---

### 🤖 Assistant

> 🔧 called: read_file, list_files



> 🔧 **list_files** — agents/cutover

> 🔧 **read_file** — docs/FLOW.md

### 🤖 Assistant

> 🔧 called: list_files



> 🔧 **list_files** — agents

### 🤖 Assistant

> 🔧 called: update_todo_list

Good — the directory doesn't exist yet. I'll create everything from scratch.

> 🔧 **update_todo_list** — 
[-] Create agents/cutover/fake_alb/legacy_server.py
[ ] Create agents/cutover/fake_alb/target_server.py
[ ] Create agents/cutover/fake_alb/proxy.py
[ ] Create agents/cutover/fake_alb/harness.py
[ ] Create agents/cutover/fake_alb/weights.json (initial state)
[ ] Run harness and execute verification tests


### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — agents/cutover/fake_alb/legacy_server.py

### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[x] Create agents/cutover/fake_alb/legacy_server.py
[-] Create agents/cutover/fake_alb/target_server.py
[ ] Create agents/cutover/fake_alb/proxy.py
[ ] Create agents/cutover/fake_alb/harness.py
[ ] Create agents/cutover/fake_alb/weights.json (initial state)
[ ] Run harness and execute verification tests


### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — """
Fake target server (port 8082 by default).

ENV:
  PORT_TARGET          – listen port (default 8082)
  INJECT_TARGET_ERRORS – set to "1" to randomly return HTTP 500 on ~35% of requests
"""

import json
import os
import random
from http.server import BaseHTTPRequestHandler, HTTPServer


PORT = int(os.environ.get("PORT_TARGET", 8082))
INJECT_TARGET_ERRORS = os.environ.get("INJECT_TARGET_ERRORS", "0") == "1"
ERROR_RATE = 0.35


class TargetHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # silence default access log
        pass

    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send_json(200, {"status": "healthy"})
            return

        if self.path == "/":
            if INJECT_TARGET_ERRORS and random.random() < ERROR_RATE:
                self._send_json(
                    500,
                    {
                        "served_by": "target",
                        "status": 500,
                        "error": "internal_server_error",
                        "app": "app-orders",
                    },
                )
            else:
                self._send_json(
                    200,
                    {"served_by": "target", "status": 200, "app": "app-orders"},
                )
            return

        self._send_json(404, {"error": "not_found"})


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), TargetHandler)
    print(f"[target] listening on http://localhost:{PORT}  INJECT_TARGET_ERRORS={INJECT_TARGET_ERRORS}")
    server.serve_forever()


### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[x] Create agents/cutover/fake_alb/legacy_server.py
[x] Create agents/cutover/fake_alb/target_server.py
[-] Create agents/cutover/fake_alb/proxy.py
[ ] Create agents/cutover/fake_alb/harness.py
[ ] Create agents/cutover/fake_alb/weights.json (initial state)
[ ] Run harness and execute verification tests


### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — """
Weighted proxy — fake ALB (port 8080 by default).

Routing:
  random() * 100 < legacy_weight  → forward to legacy_server
  else                             → forward to target_server

Weight state lives in fake_alb/weights.json so it can be read by other
processes (e.g. the Cutover agent).

Special endpoints (not forwarded):
  GET  /weights  → current weights
  POST /weights  → {"legacy": N, "target": M}  (saves to weights.json)
  GET  /metrics  → rolling-window stats over last 100 requests

ENV:
  PORT_PROXY    – listen port (default 8080)
  PORT_LEGACY   – legacy backend port (default 8081)
  PORT_TARGET   – target backend port (default 8082)
  WEIGHTS_FILE  – path to weights JSON (default: <this dir>/weights.json)
"""

import json
import os
import random
import time
import urllib.error
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Lock
from typing import Deque, Tuple

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

PORT_PROXY = int(os.environ.get("PORT_PROXY", 8080))
PORT_LEGACY = int(os.environ.get("PORT_LEGACY", 8081))
PORT_TARGET = int(os.environ.get("PORT_TARGET", 8082))

_HERE = Path(__file__).parent
WEIGHTS_FILE = Path(os.environ.get("WEIGHTS_FILE", _HERE / "weights.json"))

WINDOW_SIZE = 100

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------

_lock = Lock()
# Each entry: (timestamp_s, status_code, latency_ms, served_by)
_window: Deque[Tuple[float, int, float, str]] = deque(maxlen=WINDOW_SIZE)


def _load_weights() -> dict:
    """Read weights from disk; return defaults if missing or corrupt."""
    try:
        data = json.loads(WEIGHTS_FILE.read_text())
        legacy = int(data.get("legacy", 100))
        target = int(data.get("target", 0))
        return {"legacy": legacy, "target": target}
    except Exception:
        return {"legacy": 100, "target": 0}


def _save_weights(legacy: int, target: int) -> None:
    WEIGHTS_FILE.write_text(json.dumps({"legacy": legacy, "target": target}))


def _record(status_code: int, latency_ms: float, served_by: str) -> None:
    with _lock:
        _window.append((time.time(), status_code, latency_ms, served_by))


def _compute_metrics() -> dict:
    with _lock:
        snapshot = list(_window)

    total = len(snapshot)
    if total == 0:
        return {
            "error_rate": 0.0,
            "p95_ms": 0.0,
            "served_by": {"legacy": 0, "target": 0},
            "total": 0,
            "window_size": WINDOW_SIZE,
        }

    errors = sum(1 for _, sc, _, _ in snapshot if sc >= 500)
    latencies = sorted(entry[2] for entry in snapshot)
    p95_index = max(0, int(len(latencies) * 0.95) - 1)
    p95 = latencies[p95_index]

    by_legacy = sum(1 for _, _, _, sb in snapshot if sb == "legacy")
    by_target = sum(1 for _, _, _, sb in snapshot if sb == "target")

    return {
        "error_rate": round(errors / total * 100, 2),
        "p95_ms": round(p95, 2),
        "served_by": {"legacy": by_legacy, "target": by_target},
        "total": total,
        "window_size": WINDOW_SIZE,
    }


def _forward(host_port: str, path: str, served_by: str) -> Tuple[int, bytes]:
    """Forward the request and return (status_code, body_bytes)."""
    url = f"http://localhost:{host_port}{path}"
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            body = resp.read()
            status = resp.status
    except urllib.error.HTTPError as exc:
        body = exc.read()
        status = exc.code
    except Exception as exc:
        body = json.dumps({"error": str(exc)}).encode()
        status = 502
    latency_ms = (time.perf_counter() - t0) * 1000
    _record(status, latency_ms, served_by)
    return status, body


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------

class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # silence default access log
        pass

    # ------------------------------------------------------------------ helpers

    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _send_raw(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ------------------------------------------------------------------ routes

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/weights":
            self._send_json(200, _load_weights())
            return

        if self.path == "/metrics":
            self._send_json(200, _compute_metrics())
            return

        # Forward everything else
        weights = _load_weights()
        legacy_weight = weights["legacy"]
        if random.random() * 100 < legacy_weight:
            status, body = _forward(PORT_LEGACY, self.path, "legacy")
        else:
            status, body = _forward(PORT_TARGET, self.path, "target")
        self._send_raw(status, body)

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/weights":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            try:
                data = json.loads(raw)
                legacy = int(data["legacy"])
                target = int(data["target"])
            except (KeyError, ValueError, json.JSONDecodeError) as exc:
                self._send_json(400, {"error": f"bad request: {exc}"})
                return
            _save_weights(legacy, target)
            self._send_json(200, {"legacy": legacy, "target": target})
            return

        self._send_json(404, {"error": "not_found"})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Ensure weights file exists
    if not WEIGHTS_FILE.exists():
        _save_weights(100, 0)

    server = HTTPServer(("0.0.0.0", PORT_PROXY), ProxyHandler)
    weights = _load_weights()
    print(
        f"[proxy]  listening on http://localhost:{PORT_PROXY}  "
        f"weights={weights}  backends=legacy:{PORT_LEGACY} target:{PORT_TARGET}"
    )
    server.serve_forever()


### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[x] Create agents/cutover/fake_alb/legacy_server.py
[x] Create agents/cutover/fake_alb/target_server.py
[x] Create agents/cutover/fake_alb/proxy.py
[-] Create agents/cutover/fake_alb/harness.py
[ ] Create agents/cutover/fake_alb/weights.json (initial state)
[ ] Run harness and execute verification tests


### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — """
Fake-ALB harness — starts legacy_server, target_server, and proxy as
subprocesses, then waits for Ctrl+C and shuts everything down cleanly.

Usage:
  python harness.py                  # no error injection
  python harness.py --inject-errors 1  # enable 35% errors on legacy

ENV overrides still apply (PORT_LEGACY / PORT_TARGET / PORT_PROXY).
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

_HERE = Path(__file__).parent


def _wait_for_port(port: int, timeout: float = 10.0) -> bool:
    """Poll until the port accepts TCP connections or timeout expires."""
    import socket

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Fake-ALB harness")
    parser.add_argument(
        "--inject-errors",
        type=int,
        default=0,
        metavar="0|1",
        help="Set to 1 to inject ~35%% errors on legacy server (default 0)",
    )
    args = parser.parse_args()

    port_legacy = int(os.environ.get("PORT_LEGACY", 8081))
    port_target = int(os.environ.get("PORT_TARGET", 8082))
    port_proxy = int(os.environ.get("PORT_PROXY", 8080))

    # Build shared environment for child processes
    env = os.environ.copy()
    env["INJECT_ERRORS"] = str(args.inject_errors)

    procs = []

    def start(label: str, script: str, extra_env: dict | None = None) -> subprocess.Popen:
        e = {**env, **(extra_env or {})}
        proc = subprocess.Popen(
            [sys.executable, str(_HERE / script)],
            env=e,
            # Let stdout/stderr flow through to the terminal
        )
        procs.append((label, proc))
        return proc

    print("=" * 60)
    print("  Fake-ALB harness")
    print("=" * 60)

    start("legacy", "legacy_server.py")
    start("target", "target_server.py")

    # Give the backends a moment before starting the proxy
    if not _wait_for_port(port_legacy):
        print(f"[harness] WARNING: legacy server did not come up on :{port_legacy}")
    if not _wait_for_port(port_target):
        print(f"[harness] WARNING: target server did not come up on :{port_target}")

    start("proxy", "proxy.py")

    if not _wait_for_port(port_proxy):
        print(f"[harness] WARNING: proxy did not come up on :{port_proxy}")

    print()
    print(f"  Legacy  → http://localhost:{port_legacy}/")
    print(f"  Target  → http://localhost:{port_target}/")
    print(f"  Proxy   → http://localhost:{port_proxy}/")
    print()
    print(f"  Weights  GET  http://localhost:{port_proxy}/weights")
    print(f"  Weights  POST http://localhost:{port_proxy}/weights  body: {{\"legacy\":N,\"target\":M}}")
    print(f"  Metrics  GET  http://localhost:{port_proxy}/metrics")
    print()
    print(f"  INJECT_ERRORS = {args.inject_errors}")
    print()
    print("Press Ctrl+C to stop all servers.")
    print("=" * 60)

    def _shutdown(signum=None, frame=None) -> None:
        print("\n[harness] Shutting down…")
        for label, proc in reversed(procs):
            if proc.poll() is None:
                print(f"[harness] stopping {label} (pid {proc.pid})")
                proc.terminate()
        for label, proc in procs:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print(f"[harness] force-killing {label}")
                proc.kill()
        print("[harness] All servers stopped.")
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # Monitor children; restart them if they die unexpectedly
    while True:
        time.sleep(1)
        for label, proc in procs:
            rc = proc.poll()
            if rc is not None:
                print(f"[harness] {label} exited with code {rc} — stopping harness.")
                _shutdown()


if __name__ == "__main__":
    main()


### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[x] Create agents/cutover/fake_alb/legacy_server.py
[x] Create agents/cutover/fake_alb/target_server.py
[x] Create agents/cutover/fake_alb/proxy.py
[x] Create agents/cutover/fake_alb/harness.py
[-] Create agents/cutover/fake_alb/weights.json (initial state)
[ ] Run harness and execute verification tests


### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — {"legacy": 100, "target": 0}


### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[x] Create agents/cutover/fake_alb/legacy_server.py
[x] Create agents/cutover/fake_alb/target_server.py
[x] Create agents/cutover/fake_alb/proxy.py
[x] Create agents/cutover/fake_alb/harness.py
[x] Create agents/cutover/fake_alb/weights.json (initial state)
[-] Run harness and execute verification tests
