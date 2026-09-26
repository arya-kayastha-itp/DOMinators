"""agents/common/llm.py and the four hooks that use it (T4-L-1, T4-L-4 partial).

Offline by default (mock backend or a fake Bedrock client). The one live
Bedrock smoke test runs only with LLM_LIVE=1 and a real .env."""

import json
import os

import pytest

from agents import planning
from agents.blueprint import mapper_llm, mapper_rules
from agents.common import events, fixtures, llm, store
from agents.common.models import DecidedBy, EventType, Tier
from agents.cutover import explainer
from agents.discovery import tiering

MOCK = json.loads((llm.MOCK_DIR / "complete.json").read_text())["text"]


def _app(app_id):
    return {a.app_id: a for a in fixtures.apps()}[app_id]


@pytest.fixture
def mock(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "mock")


# ---------------------------------------------------------------- llm.py


def test_off_raises_llmoff_so_callers_use_rules():
    with pytest.raises(llm.LLMOff):
        llm.call_tool("s", "u", {"name": "t", "input_schema": {}})
    with pytest.raises(llm.LLMOff):
        llm.complete("s", "u")


def test_unknown_backend_is_a_config_error(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "gpt")
    with pytest.raises(ValueError):
        llm.complete("s", "u")


def test_mock_serves_canned_answers(mock):
    assert llm.call_tool("s", "u", {"name": "submit_tiering", "input_schema": {}})["tier"] == "GRAY"
    assert llm.complete("s", "u") == MOCK


def test_bedrock_forces_the_tool_and_returns_its_input(monkeypatch):
    seen = {}

    class FakeRuntime:
        def converse(self, **kw):
            seen.update(kw)
            return {"stopReason": "tool_use", "output": {"message": {"content": [
                {"toolUse": {"toolUseId": "1", "name": "submit_tiering", "input": {"tier": "RED"}}}]}}}

    monkeypatch.setenv("LLM_BACKEND", "bedrock")
    monkeypatch.setenv("LLM_MODEL_ID", "global.anthropic.claude-sonnet-4-6")
    monkeypatch.setattr(llm, "_bedrock_client", lambda: FakeRuntime())
    out = llm.call_tool("sys", "user", {"name": "submit_tiering", "description": "d", "input_schema": {"type": "object"}})
    assert out == {"tier": "RED"}
    assert seen["modelId"] == "global.anthropic.claude-sonnet-4-6"
    assert seen["toolConfig"]["toolChoice"] == {"tool": {"name": "submit_tiering"}}


def test_bedrock_without_a_tool_call_is_an_error(monkeypatch):
    class FakeRuntime:
        def converse(self, **kw):
            return {"stopReason": "end_turn", "output": {"message": {"content": [{"text": "no"}]}}}

    monkeypatch.setenv("LLM_BACKEND", "bedrock")
    monkeypatch.setenv("LLM_MODEL_ID", "m")
    monkeypatch.setattr(llm, "_bedrock_client", lambda: FakeRuntime())
    with pytest.raises(llm.LLMError):
        llm.call_tool("s", "u", {"name": "submit_tiering", "input_schema": {}})


def test_bedrock_needs_a_model_id(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "bedrock")
    monkeypatch.setenv("LLM_MODEL_ID", "")
    with pytest.raises(llm.LLMOff):
        llm.complete("s", "u")


TOOL = {"name": "submit_tiering", "description": "d", "input_schema": {"type": "object"}}


@pytest.fixture
def watsonx_env(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "watsonx")
    monkeypatch.setenv("WATSONX_API_KEY", "k")
    monkeypatch.setenv("WATSONX_URL", "https://eu-de.ml.cloud.ibm.com")
    monkeypatch.setenv("WATSONX_PROJECT_ID", "p")
    monkeypatch.setenv("WATSONX_MODEL_ID", "ibm/granite-4-h-small")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setattr(llm, "_ibm_token", {})


def _fake_post(responses, calls):
    def post(url, *, json_body=None, form=None, headers=None):
        calls.append((url, json_body, form, headers))
        for host, answer in responses.items():
            if host in url:
                if isinstance(answer, Exception):
                    raise answer
                return answer
        raise AssertionError(url)
    return post


def test_watsonx_gets_an_iam_token_then_forces_the_tool(watsonx_env, monkeypatch):
    calls = []
    monkeypatch.setattr(llm, "_post", _fake_post({
        "iam.cloud.ibm.com": {"access_token": "tok", "expiration": 9_999_999_999},
        "ml.cloud.ibm.com": {"choices": [{"message": {"tool_calls": [
            {"function": {"name": "submit_tiering", "arguments": '{"tier": "GRAY"}'}}]}}]},
    }, calls))
    assert llm.call_tool("s", "u", TOOL) == {"tier": "GRAY"}
    llm.call_tool("s", "u", TOOL)  # token is cached: one IAM call for two chats
    assert sum("iam" in c[0] for c in calls) == 1
    url, body, _, headers = calls[1]
    assert "/ml/v1/text/chat?version=" in url and headers["Authorization"] == "Bearer tok"
    assert body["model_id"] == "ibm/granite-4-h-small" and body["project_id"] == "p"
    assert body["tool_choice"] == {"type": "function", "function": {"name": "submit_tiering"}}


def test_watsonx_accepts_json_content_instead_of_a_tool_call(watsonx_env, monkeypatch):
    monkeypatch.setattr(llm, "_post", _fake_post({
        "iam.cloud.ibm.com": {"access_token": "tok"},
        "ml.cloud.ibm.com": {"choices": [{"message": {"content": '```json\n{"tier": "RED"}\n```'}}]},
    }, []))
    assert llm.call_tool("s", "u", TOOL) == {"tier": "RED"}


def test_watsonx_falls_back_to_gemini_when_configured(watsonx_env, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    calls = []
    monkeypatch.setattr(llm, "_post", _fake_post({
        "iam.cloud.ibm.com": llm.LLMError("HTTP 401"),
        "generativelanguage": {"candidates": [{"content": {"parts": [
            {"thought": True, "text": "thinking"}, {"text": "Gemini says hi."}]}}]},
    }, calls))
    assert llm.complete("s", "u") == "Gemini says hi."
    assert calls[-1][3]["x-goog-api-key"] == "g"


def test_watsonx_without_gemini_raises_so_callers_use_rules(watsonx_env, monkeypatch):
    monkeypatch.setattr(llm, "_post", _fake_post({"iam.cloud.ibm.com": llm.LLMError("HTTP 401")}, []))
    with pytest.raises(llm.LLMError):
        llm.complete("s", "u")


def test_watsonx_unconfigured_is_llmoff(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "watsonx")
    monkeypatch.setenv("WATSONX_URL", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    with pytest.raises(llm.LLMOff):
        llm.complete("s", "u")


def test_gemini_forces_the_function_call(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    calls = []
    monkeypatch.setattr(llm, "_post", _fake_post({"generativelanguage": {"candidates": [{"content": {"parts": [
        {"functionCall": {"name": "submit_tiering", "args": {"tier": "GOLDEN"}}}]}}]}}, calls))
    assert llm.call_tool("s", "u", TOOL) == {"tier": "GOLDEN"}
    body = calls[0][1]
    assert body["toolConfig"]["functionCallingConfig"] == {"mode": "ANY", "allowedFunctionNames": ["submit_tiering"]}
    assert body["tools"][0]["functionDeclarations"][0]["parametersJsonSchema"] == {"type": "object"}


# ---------------------------------------------------------------- hooks


def test_borderline_tiering_goes_to_the_llm(mock, monkeypatch):
    monkeypatch.setattr(tiering, "BORDERLINE", 20)  # makes the 90-point apps borderline
    tiers = {t.app_id: t for t in tiering.tier_all(fixtures.apps(), fixtures.edges())}
    assert tiers["app-orders"].decided_by == DecidedBy.LLM and tiers["app-orders"].tier == Tier.GRAY
    assert tiers["app-catalog"].decided_by == DecidedBy.RULES  # 100: not borderline
    assert tiers["app-gitea"].decided_by == DecidedBy.RULES and tiers["app-gitea"].tier == Tier.RED  # RED never asked


def test_mapper_uses_the_llm_but_pins_port_and_env(mock, tmp_path, monkeypatch):
    answer = json.loads((llm.MOCK_DIR / "set_golden_inputs.json").read_text())
    answer.update(port=9999, env={"UPSTREAM_URL": "http://made-up/"}, instance_type="t3.small")
    (tmp_path / "set_golden_inputs.json").write_text(json.dumps(answer))
    monkeypatch.setattr(llm, "MOCK_DIR", tmp_path)

    app = _app("app-orders")
    rules, _ = mapper_rules.map_app(app)
    inputs, gaps, used_llm = mapper_llm.map_app(app)
    assert used_llm
    assert inputs.port == rules.port and inputs.env == rules.env  # model's port/env ignored
    assert inputs.instance_type == "t3.small" and inputs.tags["cost-center"] == "cc-retail"
    assert [g.field for g in gaps] == ["cost-center"]


def test_mapper_falls_back_to_rules_after_two_bad_answers(mock, tmp_path, monkeypatch):
    (tmp_path / "set_golden_inputs.json").write_text(json.dumps(
        {"port": 8080, "instance_type": "m5.24xlarge", "env": {}, "tags": {}}))
    monkeypatch.setattr(llm, "MOCK_DIR", tmp_path)

    app = _app("app-catalog")
    inputs, _, used_llm = mapper_llm.map_app(app)
    assert not used_llm and inputs == mapper_rules.map_app(app)[0]
    assert any(e.type == EventType.LLM_FALLBACK for e in events.events_since(0))


def test_explainer_uses_the_llm(mock):
    assert explainer.explain("app-catalog", "MIGRATED", [], None) == MOCK


def test_planning_pilot_rationale_from_the_llm(mock):
    store.upsert_apps(fixtures.apps())
    store.upsert_tiers(fixtures.tiers())
    store.replace_edges(fixtures.edges())
    plan = planning.run()
    assert plan.waves[0].rationale == MOCK
    assert plan.waves[0].app_ids == fixtures.plan().waves[0].app_ids  # order never from the model
    assert plan.waves[1:] == [] or plan.waves[1].rationale != MOCK


def test_planning_keeps_the_template_when_off():
    store.upsert_apps(fixtures.apps())
    store.upsert_tiers(fixtures.tiers())
    store.replace_edges(fixtures.edges())
    assert planning.run().waves[0].rationale == fixtures.plan().waves[0].rationale


# ---------------------------------------------------------------- live


@pytest.mark.skipif(os.getenv("LLM_LIVE") != "1", reason="live smoke test: set LLM_LIVE=1")
def test_live_smoke(monkeypatch):
    """Uses the backend .env selects (LLM_LIVE_BACKEND overrides it)."""
    from dotenv import dotenv_values

    env = dotenv_values(llm.aws.REPO_ROOT / ".env")
    kind = os.getenv("LLM_LIVE_BACKEND") or env.get("LLM_BACKEND") or "off"
    if kind in ("off", "mock"):
        pytest.skip(f"LLM_BACKEND={kind} in .env: nothing live to test")
    monkeypatch.setenv("LLM_BACKEND", kind)
    if kind == "watsonx":
        monkeypatch.setenv("GEMINI_API_KEY", "")  # test watsonx itself, not the fallback
    tool = {"name": "submit_tier", "description": "Submit a tier.", "input_schema": {
        "type": "object", "properties": {"tier": {"type": "string", "enum": ["GOLDEN", "GRAY", "RED"]}},
        "required": ["tier"]}}
    out = llm.call_tool("Answer via the tool.", "Tier an app that stores user data on local disk.", tool)
    assert out["tier"] in {"GOLDEN", "GRAY", "RED"}
    assert llm.complete("Reply in one word.", "Say ok.", max_tokens=10)
