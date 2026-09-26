"""Post-decision explainer (T3-C-8). The rollback decision is already final
by the time this runs — it only ever writes the sentence.

Same status as every other LLM hook in this repo (agents/discovery/tiering.py
`_llm_tier`, agents/blueprint/mapper_llm.py): `_llm_available()` is False
until Track 4 ships `agents/common/llm.py` (T4-L-1), so only the template
path is exercised today. The template has to read fine on its own, since
that's what actually runs with `LLM_BACKEND=off`.
"""

from __future__ import annotations

import os

from agents.common.models import GateSample, Rollback

SYSTEM = (
    "You explain the result of an automated app cutover in one sentence a judge can "
    "read on a dashboard. State the decision, the key metric that drove it, and (for a "
    "rollback) which side served the errors. Never suggest a different decision — the "
    "rollback already happened; you are only narrating it."
)


def _llm_available() -> bool:
    if os.getenv("LLM_BACKEND", "off") in ("off", ""):
        return False
    try:
        from agents.common import llm  # noqa: F401  (Track 4, T4-L-1)
    except ImportError:
        return False
    return True


def _template(app_id: str, result: str, history: list[GateSample], rollback: Rollback | None) -> str:
    if result == "MIGRATED":
        steps = ", ".join(f"{h.weight}%" for h in history)
        return f"All gates passed at {steps}; traffic followed the weights." if steps else "Migrated."
    if result == "ROLLED_BACK" and rollback is not None:
        failed = next((h for h in history if h.weight == rollback.at_weight), history[-1] if history else None)
        detail = f"{failed.error_rate:.0%} error rate, p95 {failed.p95_ms:.0f}ms" if failed else rollback.reason
        return f"Rolled back at {rollback.at_weight}%: {detail} ({rollback.reason}). Weights restored to 100/0."
    if result == "ABORTED":
        return "Aborted before shifting any traffic: the target group wasn't healthy."
    return "No explanation available."


def explain(app_id: str, result: str, history: list[GateSample], rollback: Rollback | None) -> str:
    if _llm_available():
        try:
            from agents.common import llm

            user = (
                f"app_id={app_id} result={result} "
                f"history={[h.to_dict() for h in history]} "
                f"rollback={rollback.to_dict() if rollback else None}"
            )
            return llm.complete(SYSTEM, user, max_tokens=100).strip()
        except Exception:  # noqa: BLE001 - any LLM failure falls back to the template
            pass
    return _template(app_id, result, history, rollback)
