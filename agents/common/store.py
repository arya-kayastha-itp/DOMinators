"""SQLite state store — the API every track codes against (CONTRACTS.md addendum).

One file, WAL mode, one connection per thread. Everything is an upsert, so
re-running an agent is always safe.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agents.common.models import (
    AppRecord,
    AppStatus,
    BlueprintResult,
    CutoverRun,
    Edge,
    Tiering,
    TrafficSample,
    WavePlan,
)

_DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "state.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS apps (
    app_id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tiers (app_id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS edges (
    src TEXT NOT NULL, dst TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (src, dst));
CREATE TABLE IF NOT EXISTS plans (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blueprints (app_id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cutovers (app_id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS traffic (
    epoch REAL NOT NULL, app_id TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS traffic_app_epoch ON traffic (app_id, epoch);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, agent TEXT NOT NULL,
    app_id TEXT, type TEXT NOT NULL, level TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS flags (name TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

_lock = threading.Lock()
_local = threading.local()
_path = Path(os.getenv("MIG_STORE_PATH", _DEFAULT_PATH))
_generation = 0


def configure(path: str | Path) -> None:
    """Point the store at a different database file (tests, orchestrator)."""
    global _path, _generation
    with _lock:
        _path = Path(path)
        _generation += 1


def conn() -> sqlite3.Connection:
    """This thread's connection, created (and the schema applied) on first use."""
    c = getattr(_local, "conn", None)
    if c is None or getattr(_local, "generation", None) != _generation:
        if c is not None:
            c.close()
        # Serialized: threads opening their first connection at the same time
        # would otherwise race on switching to WAL and creating the schema.
        with _lock:
            _path.parent.mkdir(parents=True, exist_ok=True)
            c = sqlite3.connect(_path, timeout=30, isolation_level=None, check_same_thread=False)
            c.execute("PRAGMA busy_timeout=30000")
            c.execute("PRAGMA journal_mode=WAL")
            c.executescript(_SCHEMA)
        _local.conn, _local.generation = c, _generation
    return c


def _write(sql: str, rows: list[tuple]) -> None:
    c = conn()
    with _lock:
        c.execute("BEGIN IMMEDIATE")
        try:
            c.executemany(sql, rows)
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise


# ---------------------------------------------------------------- apps


def upsert_apps(apps: list[AppRecord]) -> None:
    _write(
        "INSERT INTO apps (app_id, source, status, body) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(app_id) DO UPDATE SET source=excluded.source, status=excluded.status, body=excluded.body",
        [(a.app_id, a.source.value, a.status.value, a.to_json()) for a in apps],
    )


def get_apps(source: str | None = None) -> list[AppRecord]:
    if source is None:
        rows = conn().execute("SELECT body FROM apps ORDER BY app_id").fetchall()
    else:
        rows = conn().execute("SELECT body FROM apps WHERE source = ? ORDER BY app_id", (source,)).fetchall()
    return [AppRecord.model_validate_json(r[0]) for r in rows]


def set_status(app_id: str, status: str) -> None:
    status = AppStatus(status).value
    row = conn().execute("SELECT body FROM apps WHERE app_id = ?", (app_id,)).fetchone()
    if row is None:
        raise KeyError(f"unknown app_id: {app_id}")
    app = AppRecord.model_validate_json(row[0]).model_copy(update={"status": AppStatus(status)})
    _write("UPDATE apps SET status = ?, body = ? WHERE app_id = ?", [(status, app.to_json(), app_id)])


# ---------------------------------------------------------------- tiers + edges


def upsert_tiers(tiers: list[Tiering]) -> None:
    _write(
        "INSERT INTO tiers (app_id, body) VALUES (?, ?) ON CONFLICT(app_id) DO UPDATE SET body=excluded.body",
        [(t.app_id, t.to_json()) for t in tiers],
    )


def get_tiers() -> list[Tiering]:
    return [Tiering.model_validate_json(r[0]) for r in conn().execute("SELECT body FROM tiers ORDER BY app_id")]


def replace_edges(edges: list[Edge]) -> None:
    c = conn()
    with _lock:
        c.execute("BEGIN IMMEDIATE")
        try:
            c.execute("DELETE FROM edges")
            c.executemany(
                "INSERT OR REPLACE INTO edges (src, dst, body) VALUES (?, ?, ?)",
                [(e.from_, e.to, e.to_json()) for e in edges],
            )
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise


def get_edges() -> list[Edge]:
    return [Edge.model_validate_json(r[0]) for r in conn().execute("SELECT body FROM edges ORDER BY src, dst")]


# ---------------------------------------------------------------- plan, blueprints, cutovers


def save_plan(plan: WavePlan) -> None:
    _write("INSERT OR REPLACE INTO plans (id, body) VALUES (1, ?)", [(plan.to_json(),)])


def get_plan() -> WavePlan | None:
    row = conn().execute("SELECT body FROM plans WHERE id = 1").fetchone()
    return WavePlan.model_validate_json(row[0]) if row else None


def save_blueprint(b: BlueprintResult) -> None:
    _write("INSERT OR REPLACE INTO blueprints (app_id, body) VALUES (?, ?)", [(b.app_id, b.to_json())])


def save_blueprints(blueprints: list[BlueprintResult]) -> None:
    """Batch form of save_blueprint, one transaction (T3-B-10: 1,000 synthetic
    dry runs in one write instead of 1,000 — additive, no existing signature changed)."""
    _write(
        "INSERT INTO blueprints (app_id, body) VALUES (?, ?) ON CONFLICT(app_id) DO UPDATE SET body=excluded.body",
        [(b.app_id, b.to_json()) for b in blueprints],
    )


def get_blueprint(app_id: str) -> BlueprintResult | None:
    row = conn().execute("SELECT body FROM blueprints WHERE app_id = ?", (app_id,)).fetchone()
    return BlueprintResult.model_validate_json(row[0]) if row else None


def save_cutover(c: CutoverRun) -> None:
    _write("INSERT OR REPLACE INTO cutovers (app_id, body) VALUES (?, ?)", [(c.app_id, c.to_json())])


def save_cutovers(cutovers: list[CutoverRun]) -> None:
    """Batch form of save_cutover, one transaction (T3-C-9: a whole simulated
    wave in one write instead of one per app — additive, no existing signature changed)."""
    _write(
        "INSERT INTO cutovers (app_id, body) VALUES (?, ?) ON CONFLICT(app_id) DO UPDATE SET body=excluded.body",
        [(c.app_id, c.to_json()) for c in cutovers],
    )


def get_cutover(app_id: str) -> CutoverRun | None:
    row = conn().execute("SELECT body FROM cutovers WHERE app_id = ?", (app_id,)).fetchone()
    return CutoverRun.model_validate_json(row[0]) if row else None


# ---------------------------------------------------------------- traffic


def _epoch(ts: datetime) -> float:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.timestamp()


def insert_traffic(samples: list[TrafficSample]) -> None:
    _write(
        "INSERT INTO traffic (epoch, app_id, body) VALUES (?, ?, ?)",
        [(_epoch(s.ts), s.app_id, s.to_json()) for s in samples],
    )


def traffic_window(app_id: str, seconds: int) -> list[TrafficSample]:
    since = _epoch(datetime.now(timezone.utc) - timedelta(seconds=seconds))
    rows = conn().execute(
        "SELECT body FROM traffic WHERE app_id = ? AND epoch >= ? ORDER BY epoch", (app_id, since)
    )
    return [TrafficSample.model_validate_json(r[0]) for r in rows]


# ---------------------------------------------------------------- flags + reset


def get_flag(name: str) -> str | None:
    row = conn().execute("SELECT value FROM flags WHERE name = ?", (name,)).fetchone()
    return row[0] if row else None


def set_flag(name: str, value: str) -> None:
    _write("INSERT OR REPLACE INTO flags (name, value) VALUES (?, ?)", [(name, value)])


def reset() -> None:
    c = conn()
    with _lock:
        c.execute("BEGIN IMMEDIATE")
        try:
            for table in ("apps", "tiers", "edges", "plans", "blueprints", "cutovers", "traffic", "events", "flags"):
                c.execute(f"DELETE FROM {table}")
            c.execute("DELETE FROM sqlite_sequence WHERE name = 'events'")
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise
