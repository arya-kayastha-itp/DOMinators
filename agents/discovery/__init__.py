"""Discovery agent.

G0 stub: replays fixtures/ through the real store and event log so the
orchestrator and dashboard can be wired now. Replaced by the real scanner,
rules, dependency mapping and tiering in T2-D-1..7.
"""

from __future__ import annotations

from typing import Literal

from agents.common import events, fixtures, store
from agents.common.models import DiscoverySummary, EventType


def run(scope: Literal["real", "synthetic", "all"] = "all") -> DiscoverySummary:
    events.emit("discovery", None, EventType.DISCOVERY_STARTED, {"scope": scope, "stub": True})
    apps = fixtures.apps()
    store.upsert_apps(apps)
    store.upsert_tiers(fixtures.tiers())
    store.replace_edges(fixtures.edges())
    events.emit_batch(
        "discovery",
        [(a.app_id, EventType.APP_DISCOVERED, {"findings": [f.value for f in a.findings]}) for a in apps],
    )
    summary = fixtures.summary()
    events.emit("discovery", None, EventType.DISCOVERY_DONE, summary.to_dict())
    return summary
