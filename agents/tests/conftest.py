import pytest

from agents.common import store


@pytest.fixture(autouse=True)
def llm_off(monkeypatch):
    # .env may say LLM_BACKEND=bedrock; tests opt in to an LLM explicitly.
    monkeypatch.setenv("LLM_BACKEND", "off")


@pytest.fixture(autouse=True)
def isolated_store(tmp_path):
    store.configure(tmp_path / "state.db")
    yield
    store.reset()
