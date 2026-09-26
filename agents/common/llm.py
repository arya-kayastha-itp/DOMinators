"""Shared LLM client (T4-L-1). Backend picked by LLM_BACKEND:

- `bedrock`   — Bedrock Converse API through boto3 (already a dependency, so no
                `anthropic` SDK to install). Credentials are the `aws.target()`
                profile, or a Bedrock API key if AWS_BEARER_TOKEN_BEDROCK is set
                (botocore picks that up on its own). Model from LLM_MODEL_ID —
                an inference-profile id, e.g. `global.anthropic.claude-sonnet-4-6`.
- `anthropic` — Anthropic API with ANTHROPIC_API_KEY; needs the `anthropic`
                package, which is optional and imported only here.
- `off`       — every call raises LLMOff, so callers take their rules path.
- `mock`      — canned answers from fixtures/llm_mock/<tool name>.json and
                fixtures/llm_mock/complete.json; no network.

Every call has a 20 s timeout and no retries: callers own the fallback, and a
slow model must not hold up a demo step.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from agents.common import aws  # also loads .env

TIMEOUT_S = 20
MOCK_DIR = aws.REPO_ROOT / "fixtures" / "llm_mock"
BACKENDS = ("bedrock", "anthropic", "off", "mock")


class LLMOff(RuntimeError):
    """LLM_BACKEND=off (or unset): use the rules path."""


class LLMError(RuntimeError):
    """The model answered, but not with what was asked for."""


def backend() -> str:
    name = (os.getenv("LLM_BACKEND") or "off").strip().lower()
    if name not in BACKENDS:
        raise ValueError(f"LLM_BACKEND={name!r} — expected one of {', '.join(BACKENDS)}")
    return name


def model_id() -> str:
    model = os.getenv("LLM_MODEL_ID", "").strip()
    if not model:
        raise LLMOff("LLM_MODEL_ID is not set")
    return model


@lru_cache(maxsize=1)
def _bedrock():
    import boto3
    from botocore.config import Config

    config = Config(connect_timeout=5, read_timeout=TIMEOUT_S, retries={"max_attempts": 1})
    if os.getenv("AWS_BEARER_TOKEN_BEDROCK"):
        return boto3.Session(region_name=aws.region()).client("bedrock-runtime", config=config)
    return aws.target().client("bedrock-runtime", config=config)


@lru_cache(maxsize=1)
def _anthropic():
    from anthropic import Anthropic  # pyright: ignore[reportMissingImports] - optional, only for LLM_BACKEND=anthropic

    return Anthropic(timeout=TIMEOUT_S, max_retries=0)


def _mock(name: str) -> dict:
    path = MOCK_DIR / f"{name}.json"
    if not path.exists():
        raise LLMError(f"no mock answer at {path.relative_to(aws.REPO_ROOT)}")
    return json.loads(Path(path).read_text(encoding="utf-8"))


def call_tool(system: str, user: str, tool: dict, *, max_tokens: int = 1024) -> dict:
    """Force the model to call `tool` (Anthropic tool schema: name, description,
    input_schema) and return its input. The caller validates the fields."""
    kind = backend()
    if kind == "off":
        raise LLMOff("LLM_BACKEND=off")
    if kind == "mock":
        return _mock(tool["name"])
    if kind == "bedrock":
        resp = _bedrock().converse(
            modelId=model_id(),
            system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": user}]}],
            inferenceConfig={"maxTokens": max_tokens},
            toolConfig={
                "tools": [{"toolSpec": {"name": tool["name"], "description": tool.get("description", ""),
                                        "inputSchema": {"json": tool["input_schema"]}}}],
                "toolChoice": {"tool": {"name": tool["name"]}},
            },
        )
        for block in resp["output"]["message"]["content"]:
            if "toolUse" in block and block["toolUse"]["name"] == tool["name"]:
                return dict(block["toolUse"]["input"])
        raise LLMError(f"model did not call {tool['name']} (stopReason={resp.get('stopReason')})")
    resp = _anthropic().messages.create(
        model=model_id(), max_tokens=max_tokens, system=system, tools=[tool],
        tool_choice={"type": "tool", "name": tool["name"]},
        messages=[{"role": "user", "content": user}],
    )
    for block in resp.content:
        if block.type == "tool_use" and block.name == tool["name"]:
            return dict(block.input)
    raise LLMError(f"model did not call {tool['name']} (stop_reason={resp.stop_reason})")


def complete(system: str, user: str, *, max_tokens: int = 300) -> str:
    """Plain text answer (explanations, rationales)."""
    kind = backend()
    if kind == "off":
        raise LLMOff("LLM_BACKEND=off")
    if kind == "mock":
        return _mock("complete")["text"]
    if kind == "bedrock":
        resp = _bedrock().converse(
            modelId=model_id(),
            system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": user}]}],
            inferenceConfig={"maxTokens": max_tokens},
        )
        text = "".join(b.get("text", "") for b in resp["output"]["message"]["content"]).strip()
    else:
        resp = _anthropic().messages.create(
            model=model_id(), max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
    if not text:
        raise LLMError("empty completion")
    return text
