"""Load the shared fixtures in fixtures/ as validated models."""

from __future__ import annotations

import json
from pathlib import Path

from agents.common.models import (
    AppRecord,
    BlueprintResult,
    CutoverRun,
    DiscoverySummary,
    Edge,
    Event,
    Tiering,
    TrafficSample,
    WavePlan,
)

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def raw(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def apps() -> list[AppRecord]:
    return [AppRecord.model_validate(a) for a in raw("apps.json")]


def tiers() -> list[Tiering]:
    return [Tiering.model_validate(t) for t in raw("tiers.json")]


def edges() -> list[Edge]:
    return [Edge.model_validate(e) for e in raw("edges.json")]


def plan() -> WavePlan:
    return WavePlan.model_validate(raw("plan.json"))


def summary() -> DiscoverySummary:
    return DiscoverySummary.model_validate(raw("summary.json"))


def blueprint(app_id: str = "app-catalog") -> BlueprintResult:
    return BlueprintResult.model_validate(raw(f"blueprint_{app_id}.json"))


def cutover(app_id: str) -> CutoverRun:
    return CutoverRun.model_validate(raw(f"cutover_{app_id}.json"))


def traffic(app_id: str) -> list[TrafficSample]:
    return [TrafficSample.model_validate(s) for s in raw(f"traffic_{app_id}.json")]


def events() -> list[Event]:
    lines = (FIXTURES / "events.jsonl").read_text(encoding="utf-8").splitlines()
    return [Event.model_validate_json(line) for line in lines if line.strip()]
