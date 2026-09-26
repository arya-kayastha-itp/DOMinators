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
    monkeypatch.setattr(llm, "_bedrock", lambda: FakeRuntime())
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
    monkeypatch.setattr(llm, "_bedrock", lambda: FakeRuntime())
    with pytest.raises(llm.LLMError):
        llm.call_tool("s", "u", {"name": "submit_tiering", "input_schema": {}})


def test_bedrock_needs_a_model_id(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "bedrock")
    monkeypatch.setenv("LLM_MODEL_ID", "")
    with pytest.raises(llm.LLMOff):
        llm.complete("s", "u")


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


@pytest.mark.skipif(os.getenv("LLM_LIVE") != "1", reason="live Bedrock smoke test: set LLM_LIVE=1")
def test_live_bedrock_smoke(monkeypatch):
    from dotenv import dotenv_values

    model = dotenv_values(llm.aws.REPO_ROOT / ".env").get("LLM_MODEL_ID")
    monkeypatch.setenv("LLM_BACKEND", "bedrock")
    monkeypatch.setenv("LLM_MODEL_ID", model or "global.anthropic.claude-sonnet-4-6")
    tool = {"name": "submit_tier", "description": "Submit a tier.", "input_schema": {
        "type": "object", "properties": {"tier": {"type": "string", "enum": ["GOLDEN", "GRAY", "RED"]}},
        "required": ["tier"]}}
    out = llm.call_tool("Answer via the tool.", "Tier an app that stores user data on local disk.", tool)
    assert out["tier"] in {"GOLDEN", "GRAY", "RED"}
    assert llm.complete("Reply in one word.", "Say ok.", max_tokens=10)
