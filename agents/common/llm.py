"""Shared LLM client (T4-L-1). Backend picked by LLM_BACKEND:

- `watsonx`   — IBM watsonx.ai chat API (WATSONX_* in .env; model
                WATSONX_MODEL_ID, e.g. `ibm/granite-4-h-small`). If it fails and
                GEMINI_API_KEY is set, the same call is retried once on Gemini.
- `gemini`    — Google Gemini API (GEMINI_API_KEY, GEMINI_MODEL).
- `bedrock`   — Bedrock Converse API through boto3, model LLM_MODEL_ID (an
                inference-profile id). Blocked in Account B today: no payment
                method for AWS Marketplace (see checklist T1-3).
- `anthropic` — Anthropic API with ANTHROPIC_API_KEY; needs the optional
                `anthropic` package, imported only here.
- `off`       — every call raises LLMOff, so callers take their rules path.
- `mock`      — canned answers from fixtures/llm_mock/<tool name>.json and
                fixtures/llm_mock/complete.json; no network.

watsonx and Gemini are plain HTTPS calls (stdlib urllib, no SDKs). Every call
has a 20 s timeout and no retries of its own: callers own the fallback to
rules, and a slow model must not hold up a demo step.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Callable

from agents.common import aws  # also loads .env

TIMEOUT_S = 20
MOCK_DIR = aws.REPO_ROOT / "fixtures" / "llm_mock"
BACKENDS = ("watsonx", "gemini", "bedrock", "anthropic", "off", "mock")
IBM_IAM_URL = "https://iam.cloud.ibm.com/identity/token"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Gemini's thinking tokens count against maxOutputTokens; a 100-token cap
# would leave nothing for the answer.
GEMINI_MIN_OUTPUT_TOKENS = 2048


class LLMOff(RuntimeError):
    """LLM_BACKEND=off (or unset), or the backend isn't configured: use rules."""


class LLMError(RuntimeError):
    """The model answered, but not with what was asked for."""


def backend() -> str:
    name = (os.getenv("LLM_BACKEND") or "off").strip().lower()
    if name not in BACKENDS:
        raise ValueError(f"LLM_BACKEND={name!r} — expected one of {', '.join(BACKENDS)}")
    return name


def _need(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise LLMOff(f"{name} is not set")
    return value


def model_id() -> str:
    """Bedrock / Anthropic model id."""
    return _need("LLM_MODEL_ID")


# ---------------------------------------------------------------- HTTP


def _post(url: str, *, json_body: dict | None = None, form: dict | None = None,
          headers: dict | None = None) -> dict:
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        ctype = "application/x-www-form-urlencoded"
    else:
        data = json.dumps(json_body).encode()
        ctype = "application/json"
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": ctype, "Accept": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        # The body says why (bad model id, quota, schema); keys never appear in it.
        raise LLMError(f"HTTP {exc.code} from {urllib.parse.urlsplit(url).netloc}: "
                       f"{exc.read().decode(errors='replace')[:500]}") from exc


def _parse_args(raw) -> dict:
    """Tool arguments arrive as a dict or as a JSON string, depending on the API."""
    if isinstance(raw, dict):
        return raw
    try:
        out = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise LLMError(f"tool arguments aren't JSON: {str(raw)[:200]}") from exc
    if not isinstance(out, dict):
        raise LLMError("tool arguments aren't a JSON object")
    return out


# ---------------------------------------------------------------- watsonx

_ibm_token: dict = {}


def _watsonx_token() -> str:
    if _ibm_token.get("expires", 0) - 60 > time.time():
        return _ibm_token["token"]
    out = _post(IBM_IAM_URL, form={"grant_type": "urn:ibm:params:oauth:grant-type:apikey",
                                   "apikey": _need("WATSONX_API_KEY")})
    _ibm_token.update(token=out["access_token"], expires=out.get("expiration", time.time() + 3000))
    return _ibm_token["token"]


def _watsonx(system: str, user: str, tool: dict | None, max_tokens: int):
    base = _need("WATSONX_URL").rstrip("/")
    body: dict = {
        "model_id": _need("WATSONX_MODEL_ID"),
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": max_tokens,
        "temperature": 0,
    }
    if os.getenv("WATSONX_PROJECT_ID", "").strip():
        body["project_id"] = os.environ["WATSONX_PROJECT_ID"].strip()
    else:
        body["space_id"] = _need("WATSONX_SPACE_ID")
    if tool:
        body["tools"] = [{"type": "function", "function": {
            "name": tool["name"], "description": tool.get("description", ""), "parameters": tool["input_schema"]}}]
        body["tool_choice"] = {"type": "function", "function": {"name": tool["name"]}}
    version = os.getenv("WATSONX_VERSION", "").strip() or "2024-05-01"
    out = _post(f"{base}/ml/v1/text/chat?version={version}", json_body=body,
                headers={"Authorization": f"Bearer {_watsonx_token()}"})
    message = out["choices"][0]["message"]
    if not tool:
        return (message.get("content") or "").strip()
    for call in message.get("tool_calls") or []:
        if call.get("function", {}).get("name") == tool["name"]:
            return _parse_args(call["function"].get("arguments"))
    # Smaller models sometimes answer with the JSON as plain content instead.
    if message.get("content"):
        return _parse_args(message["content"].strip().removeprefix("```json").removesuffix("```").strip())
    raise LLMError(f"watsonx did not call {tool['name']}")


# ---------------------------------------------------------------- Gemini


def _gemini(system: str, user: str, tool: dict | None, max_tokens: int):
    body: dict = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"maxOutputTokens": max(max_tokens, GEMINI_MIN_OUTPUT_TOKENS), "temperature": 0},
    }
    if tool:
        body["tools"] = [{"functionDeclarations": [{
            "name": tool["name"], "description": tool.get("description", ""),
            "parametersJsonSchema": tool["input_schema"]}]}]
        body["toolConfig"] = {"functionCallingConfig": {"mode": "ANY", "allowedFunctionNames": [tool["name"]]}}
    model = os.getenv("GEMINI_MODEL", "").strip() or "gemini-3.8-flash"
    out = _post(GEMINI_URL.format(model=urllib.parse.quote(model)), json_body=body,
                headers={"x-goog-api-key": _need("GEMINI_API_KEY")})
    candidates = out.get("candidates") or []
    parts = (candidates[0].get("content") or {}).get("parts", []) if candidates else []
    if not tool:
        return "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
    for p in parts:
        if p.get("functionCall", {}).get("name") == tool["name"]:
            return _parse_args(p["functionCall"].get("args", {}))
    raise LLMError(f"gemini did not call {tool['name']} (finishReason={candidates[0].get('finishReason') if candidates else None})")


# ---------------------------------------------------------------- Bedrock / Anthropic


@lru_cache(maxsize=1)
def _bedrock_client():
    import boto3
    from botocore.config import Config

    config = Config(connect_timeout=5, read_timeout=TIMEOUT_S, retries={"max_attempts": 1})
    if os.getenv("AWS_BEARER_TOKEN_BEDROCK"):
        return boto3.Session(region_name=aws.region()).client("bedrock-runtime", config=config)
    return aws.target().client("bedrock-runtime", config=config)


def _bedrock(system: str, user: str, tool: dict | None, max_tokens: int):
    kwargs: dict = dict(
        modelId=model_id(),
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": user}]}],
        inferenceConfig={"maxTokens": max_tokens},
    )
    if tool:
        kwargs["toolConfig"] = {
            "tools": [{"toolSpec": {"name": tool["name"], "description": tool.get("description", ""),
                                    "inputSchema": {"json": tool["input_schema"]}}}],
            "toolChoice": {"tool": {"name": tool["name"]}},
        }
    resp = _bedrock_client().converse(**kwargs)
    content = resp["output"]["message"]["content"]
    if not tool:
        return "".join(b.get("text", "") for b in content).strip()
    for block in content:
        if "toolUse" in block and block["toolUse"]["name"] == tool["name"]:
            return dict(block["toolUse"]["input"])
    raise LLMError(f"model did not call {tool['name']} (stopReason={resp.get('stopReason')})")


@lru_cache(maxsize=1)
def _anthropic_client():
    from anthropic import Anthropic  # pyright: ignore[reportMissingImports] - optional, only for LLM_BACKEND=anthropic

    return Anthropic(timeout=TIMEOUT_S, max_retries=0)


def _anthropic(system: str, user: str, tool: dict | None, max_tokens: int):
    kwargs: dict = dict(model=model_id(), max_tokens=max_tokens, system=system,
                        messages=[{"role": "user", "content": user}])
    if tool:
        kwargs.update(tools=[tool], tool_choice={"type": "tool", "name": tool["name"]})
    resp = _anthropic_client().messages.create(**kwargs)
    if not tool:
        return "".join(b.text for b in resp.content if b.type == "text").strip()
    for block in resp.content:
        if block.type == "tool_use" and block.name == tool["name"]:
            return dict(block.input)
    raise LLMError(f"model did not call {tool['name']} (stop_reason={resp.stop_reason})")


# ---------------------------------------------------------------- dispatch

PROVIDERS: dict[str, Callable] = {"watsonx": _watsonx, "gemini": _gemini, "bedrock": _bedrock, "anthropic": _anthropic}


def _chain(kind: str) -> list[str]:
    if kind == "watsonx" and os.getenv("GEMINI_API_KEY", "").strip():
        return ["watsonx", "gemini"]
    return [kind]


def _mock(name: str) -> dict:
    path = MOCK_DIR / f"{name}.json"
    if not path.exists():
        raise LLMError(f"no mock answer at {path.relative_to(aws.REPO_ROOT)}")
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _call(system: str, user: str, tool: dict | None, max_tokens: int) -> dict | str:
    kind = backend()
    if kind == "off":
        raise LLMOff("LLM_BACKEND=off")
    if kind == "mock":
        return _mock(tool["name"]) if tool else _mock("complete")["text"]
    errors: list[Exception] = []
    for name in _chain(kind):
        try:
            out = PROVIDERS[name](system, user, tool, max_tokens)
            if tool is None and not out:
                raise LLMError(f"empty completion from {name}")
            return out
        except Exception as exc:  # noqa: BLE001 - try the next provider, then let the caller fall back
            errors.append(exc)
    raise errors[-1]


def call_tool(system: str, user: str, tool: dict, *, max_tokens: int = 1024) -> dict:
    """Force the model to call `tool` (Anthropic tool schema: name, description,
    input_schema) and return its arguments. The caller validates the fields."""
    out = _call(system, user, tool, max_tokens)
    if not isinstance(out, dict):
        raise LLMError(f"expected {tool['name']} arguments, got text")
    return out


def complete(system: str, user: str, *, max_tokens: int = 300) -> str:
    """Plain text answer (explanations, rationales)."""
    return str(_call(system, user, None, max_tokens))
