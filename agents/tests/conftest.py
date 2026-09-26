import pytest

from agents.common import store


@pytest.fixture(autouse=True)
def isolated_store(tmp_path):
    store.configure(tmp_path / "state.db")
    yield
    store.reset()
