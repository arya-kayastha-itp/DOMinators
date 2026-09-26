"""Extra validation for GoldenInputs, beyond what the frozen Pydantic shape in
agents/common/models.py already enforces (T3-B-1).

Mirrors modules/golden_app/variables.tf's own `validation` blocks so a bad
mapper output fails here, before `terraform validate` ever runs. The
HARDCODED_IP check is the important one: it's what proves Blueprint actually
rewrote every legacy IP rather than carrying it through.
"""

from __future__ import annotations

from agents.common.models import GoldenInputs
from agents.discovery.rules import IPV4

ALLOWED_INSTANCE_TYPES = {"t3.micro", "t3.small"}
ALLOWED_RUNTIMES = {"demo-server", "juice-shop"}
REQUIRED_TAGS = ("owner", "cost-center", "data-class")


class ValidationError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def validate(inputs: GoldenInputs) -> None:
    errors: list[str] = []

    if inputs.instance_type not in ALLOWED_INSTANCE_TYPES:
        errors.append(f"instance_type {inputs.instance_type!r} not in {sorted(ALLOWED_INSTANCE_TYPES)}")

    if inputs.runtime not in ALLOWED_RUNTIMES:
        errors.append(f"runtime {inputs.runtime!r} not in {sorted(ALLOWED_RUNTIMES)}")

    if not (1 <= inputs.port <= 65535):
        errors.append(f"port must be 1-65535, got {inputs.port}")

    for key, value in inputs.env.items():
        if IPV4.search(value):
            errors.append(f"env[{key}] still has a raw IP literal: {value!r}")

    missing = [t for t in REQUIRED_TAGS if not inputs.tags.get(t)]
    if missing:
        errors.append(f"missing required tags: {missing}")

    if errors:
        raise ValidationError(errors)
