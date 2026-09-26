"""Blueprint/IaC agent (Track 3 owns the real implementation).

G0 stub: adapts the app-catalog fixture to the requested app so the
orchestrator can call it for any app. Never runs Terraform.
"""

from __future__ import annotations

from agents.common import events, fixtures, store
from agents.common.models import AppStatus, BlueprintResult, EventType


def run(app_id: str, apply: bool = False) -> BlueprintResult:
    base = fixtures.blueprint("app-catalog")
    status = AppStatus.PROVISIONED if apply else AppStatus.BLUEPRINTED
    result = base.model_copy(
        update={
            "app_id": app_id,
            "inputs": base.inputs.model_copy(update={"name": app_id}),
            "tf_dir": f"generated/{app_id}",
            "applied": apply,
            "outputs": base.outputs if apply else None,
            "status": status,
        }
    )
    store.save_blueprint(result)
    events.emit("blueprint", app_id, EventType.BLUEPRINT_READY, {"fixes": len(result.fixes), "stub": True})
    if apply:
        events.emit("blueprint", app_id, EventType.PROVISIONED, {"stub": True})
    if app_id in {a.app_id for a in store.get_apps()}:
        store.set_status(app_id, status)
    return result
