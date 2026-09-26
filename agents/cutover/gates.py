"""Pure gate evaluator (T3-C-4): no I/O, so every threshold is unit-tested
without the ALB, the traffic generator, or the store.

`evaluate()` ignores samples from the first `settle_s` seconds after a
weight change — a health check and a few in-flight requests on the old
weight land right after `modify_rule`, and counting them would make a clean
cutover look flaky for no reason.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from agents.common.models import ServedBy, TrafficSample


@dataclass
class GateConfig:
    max_error_rate: float = 0.02
    max_p95_ms: float = 800.0
    min_target_share_ratio: float = 0.8
    require_healthy_targets: bool = True
    min_requests: int = 50


@dataclass
class GateResult:
    passed: bool
    reasons: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)


def _p95(latencies: list[float]) -> float:
    if not latencies:
        return 0.0
    ordered = sorted(latencies)
    idx = min(len(ordered) - 1, round(0.95 * (len(ordered) - 1)))
    return ordered[idx]


def _error_rate(samples: list[TrafficSample]) -> float:
    return sum(s.status >= 500 or s.status == 0 for s in samples) / len(samples) if samples else 0.0


def evaluate(
    samples: list[TrafficSample],
    weight: int,
    cfg: GateConfig,
    *,
    weight_set_at: datetime | None = None,
    settle_s: float = 2.0,
    targets_healthy: bool = True,
) -> GateResult:
    if weight_set_at is not None:
        samples = [s for s in samples if (s.ts - weight_set_at).total_seconds() >= settle_s]

    reasons: list[str] = []
    total = len(samples)
    target_samples = [s for s in samples if s.served_by == ServedBy.TARGET]
    legacy_samples = [s for s in samples if s.served_by == ServedBy.LEGACY]

    overall_error_rate = _error_rate(samples)
    p95 = _p95([s.latency_ms for s in samples])
    target_share = len(target_samples) / total if total else 0.0
    expected_share = weight / 100.0

    metrics = {
        "requests": total,
        "error_rate": round(overall_error_rate, 4),
        "target_error_rate": round(_error_rate(target_samples), 4),
        "legacy_error_rate": round(_error_rate(legacy_samples), 4),
        "p95_ms": round(p95, 1),
        "target_share": round(target_share, 4),
        "expected_share": expected_share,
    }

    if cfg.require_healthy_targets and not targets_healthy:
        reasons.append("target group is unhealthy")
    if total < cfg.min_requests:
        reasons.append(f"only {total} requests observed, need >= {cfg.min_requests}")
    if overall_error_rate > cfg.max_error_rate:
        reasons.append(f"error_rate {overall_error_rate:.2f} > {cfg.max_error_rate}")
    if p95 > cfg.max_p95_ms:
        reasons.append(f"p95_ms {p95:.0f} > {cfg.max_p95_ms}")
    if expected_share > 0 and target_share < cfg.min_target_share_ratio * expected_share:
        reasons.append(
            f"target_share {target_share:.2f} < min_target_share_ratio {cfg.min_target_share_ratio} "
            f"* expected {expected_share:.2f}"
        )

    return GateResult(passed=not reasons, reasons=reasons, metrics=metrics)
