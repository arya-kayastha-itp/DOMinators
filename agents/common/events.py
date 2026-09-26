"""Event log. Every emit persists to the store's `events` table, and the
orchestrator streams from that table (ids are monotonic, so SSE can resume
from Last-Event-ID).
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import datetime, timezone

from agents.common import store
from agents.common.models import Event, EventLevel, EventType


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def emit(
    agent: str,
    app_id: str | None,
    type: EventType | str,
    payload: dict | None = None,
    level: EventLevel = "info",
) -> Event:
    return emit_batch(agent, [(app_id, type, payload)], level=level)[0]


def emit_batch(
    agent: str,
    items: Iterable[tuple[str | None, EventType | str, dict | None]],
    level: EventLevel = "info",
) -> list[Event]:
    """Emit several events in one transaction (e.g. APP_DISCOVERED in batches of 50)."""
    rows = []
    for app_id, type_, payload in items:
        rows.append((_now(), agent, app_id, EventType(type_).value, level, json.dumps(payload or {})))

    c = store.conn()
    events: list[Event] = []
    with store._lock:
        c.execute("BEGIN IMMEDIATE")
        try:
            for row in rows:
                cur = c.execute(
                    "INSERT INTO events (ts, agent, app_id, type, level, payload) VALUES (?, ?, ?, ?, ?, ?)", row
                )
                events.append(_row_to_event((cur.lastrowid, *row)))
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise
    return events


def events_since(last_id: int) -> list[Event]:
    rows = store.conn().execute(
        "SELECT id, ts, agent, app_id, type, level, payload FROM events WHERE id > ? ORDER BY id", (last_id,)
    )
    return [_row_to_event(r) for r in rows]


def _row_to_event(row: tuple) -> Event:
    id_, ts, agent, app_id, type_, level, payload = row
    return Event(id=id_, ts=ts, agent=agent, app_id=app_id, type=type_, level=level, payload=json.loads(payload))
