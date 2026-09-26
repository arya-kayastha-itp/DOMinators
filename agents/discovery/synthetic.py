"""Load the synthetic fleet. It carries raw config only (findings empty), so the
same rules -> deps -> tiering pipeline as the real apps computes everything."""

from __future__ import annotations

import json
import os
from pathlib import Path

from agents.common.models import AppRecord, Source

DEFAULT_FLEET = Path(__file__).resolve().parents[2] / "data" / "fleet.json"


def load_fleet(path: str | Path | None = None) -> list[AppRecord]:
    path = Path(path or os.getenv("FLEET_PATH", DEFAULT_FLEET))
    if not path.exists():
        raise FileNotFoundError(f"{path} not found — run: python data/generate_fleet.py --count 1000 --seed 42")
    apps = [AppRecord.model_validate(a) for a in json.loads(path.read_text(encoding="utf-8"))]
    return [a.model_copy(update={"findings": [], "source": Source.SYNTHETIC}) for a in apps]
