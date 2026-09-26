"""Risk tiering: rules first (always), the LLM only for borderline scores.

Score starts at 100: STATEFUL -60, unknown runtime -40, more than 5
dependencies -15, HARDCODED_IP -10, each finding without an auto-fix -10.
GOLDEN >= 75, GRAY 40-74, RED < 40 / stateful / commercial licence without BYOL.
Per decision D2, MISSING_TAGS doesn't force GRAY (Blueprint fills defaults and
flags the gap); a non-EC2 runtime does, because golden_app is an EC2 pattern.
"""

from __future__ import annotations

import os
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from agents.common.models import AppRecord, DecidedBy, Edge, FindingCode, Tier, Tiering

AUTO_FIXABLE = set(FindingCode) - {FindingCode.STATEFUL}
GOLDEN_MIN, GRAY_MIN, BORDERLINE = 75, 40, 5
# Free-tier LLM quotas are ~15 requests/minute (Gemini flash-lite), and Planning
# plus Blueprint need a few calls of their own right after Discovery. So: at
# most 10 borderline apps go to the LLM per run (real apps first), 4 at a time.
MAX_LLM_CONCURRENCY = 4
MAX_LLM_TIER_CALLS = 10


def degrees(edges: list[Edge]) -> Counter:
    d: Counter = Counter()
    for e in edges:
        d[e.from_] += 1
        d[e.to] += 1
    return d


def score(app: AppRecord, degree: int) -> tuple[int, list[str]]:
    findings = set(app.findings)
    s, reasons = 100, []
    if FindingCode.STATEFUL in findings:
        s -= 60
        reasons.append("stateful: data needs a migration plan (-60)")
    if app.runtime.type == "unknown":
        s -= 40
        reasons.append("unknown runtime (-40)")
    if degree > 5:
        s -= 15
        reasons.append(f"{degree} dependencies (-15)")
    if FindingCode.HARDCODED_IP in findings:
        s -= 10
        reasons.append("hardcoded IP in config (-10)")
    for code in sorted(findings - AUTO_FIXABLE):
        s -= 10
        reasons.append(f"{code.value} has no automatic fix (-10)")
    return s, reasons


def rules_tier(app: AppRecord, degree: int) -> Tiering:
    s, reasons = score(app, degree)
    findings = set(app.findings)
    if FindingCode.STATEFUL in findings or s < GRAY_MIN or app.license == "commercial":
        tier = Tier.RED
        if app.license == "commercial":
            reasons.append("commercial licence without BYOL")
    elif s < GOLDEN_MIN or app.runtime.type != "ec2":
        tier = Tier.GRAY
        if app.runtime.type != "ec2":
            reasons.append(f"{app.runtime.type} runtime: golden_app is an EC2 pattern, needs a human decision")
    else:
        tier = Tier.GOLDEN
        reasons = ["stateless", "matches golden_app pattern", "all findings auto-fixable", *reasons]
    if FindingCode.MISSING_TAGS in findings:
        reasons.append("missing business tags: auto-fixed with flagged gaps")
    return Tiering(app_id=app.app_id, tier=tier, score=s, reasons=reasons,
                   risk_summary=risk_summary(app, tier), decided_by=DecidedBy.RULES)


def risk_summary(app: AppRecord, tier: Tier) -> str:
    f = set(app.findings)
    exposure = []
    if FindingCode.PUBLIC_IP in f or FindingCode.SG_OPEN_APP in f:
        exposure.append("publicly exposed")
    if FindingCode.SG_OPEN_SSH in f:
        exposure.append("SSH open to the world")
    head = (", ".join(exposure) or "not publicly exposed").capitalize()
    if tier == Tier.RED:
        why = "stateful — needs a data migration plan" if FindingCode.STATEFUL in f else "needs engineering before it can move"
        return f"{head}; {why}, so it's parked."
    if tier == Tier.GRAY:
        return f"{head}; {len(f)} findings, at least one needs a human decision before migration."
    return f"{head}; {len(f)} findings, every fix is standard and automatable."


def _borderline(t: Tiering) -> bool:
    return any(abs(t.score - edge) <= BORDERLINE for edge in (GOLDEN_MIN, GRAY_MIN)) and t.tier != Tier.RED


def _llm_available() -> bool:
    if os.getenv("LLM_BACKEND", "off") in ("off", ""):
        return False
    try:
        from agents.common import llm  # noqa: F401  (Track 4, T4-L-1)
    except ImportError:
        return False
    return True


def _choices(t: Tiering) -> list[Tier]:
    """The two tiers either side of the threshold the score is near: the LLM
    breaks a tie, it doesn't re-tier from scratch."""
    return [Tier.GOLDEN, Tier.GRAY] if abs(t.score - GOLDEN_MIN) <= BORDERLINE else [Tier.GRAY, Tier.RED]


def _llm_tier(app: AppRecord, rules: Tiering) -> Tiering:
    """Ask the LLM via the submit_tiering tool; any failure (or a tier outside
    the two allowed) keeps the rules decision."""
    from agents.common import llm

    choices = [t.value for t in _choices(rules)]
    tool = {
        "name": "submit_tiering",
        "description": "Submit the migration risk tier for one app.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tier": {"type": "string", "enum": choices},
                "reasons": {"type": "array", "items": {"type": "string"}},
                "risk_summary": {"type": "string"},
            },
            "required": ["tier", "reasons", "risk_summary"],
        },
    }
    system = ("You tier legacy apps for a rehost migration onto a hardened EC2 pattern. "
              "GOLDEN = safe to automate, GRAY = needs a human decision, RED = needs engineering. "
              "The pattern fixes these findings automatically, so on their own they are not blockers: "
              f"{', '.join(sorted(c.value for c in AUTO_FIXABLE))}. "
              "What matters is what automation can't settle: data on the instance, many dependencies, "
              "an unusual runtime or licence. risk_summary: one or two short sentences.")
    user = (f"Rules scored this app {rules.score}/100 ({rules.tier.value}), within {BORDERLINE} points of a "
            f"threshold. Choose {' or '.join(choices)}.\n{app.model_dump_json(exclude={'tags'})}")
    try:
        out = llm.call_tool(system, user, tool)
        if out.get("tier") not in choices:
            return rules
        return Tiering(app_id=app.app_id, tier=out["tier"], score=rules.score, reasons=out["reasons"],
                       risk_summary=out["risk_summary"], decided_by=DecidedBy.LLM)
    except Exception:
        return rules


def tier_all(apps: list[AppRecord], edges: list[Edge]) -> list[Tiering]:
    d = degrees(edges)
    tiers = {a.app_id: rules_tier(a, d[a.app_id]) for a in apps}
    if _llm_available():
        borderline = [a for a in apps if _borderline(tiers[a.app_id])]
        borderline = sorted(borderline, key=lambda a: a.source != "real")[:MAX_LLM_TIER_CALLS]
        with ThreadPoolExecutor(max_workers=MAX_LLM_CONCURRENCY) as pool:
            for t in pool.map(lambda a: _llm_tier(a, tiers[a.app_id]), borderline):
                tiers[t.app_id] = t
    return [tiers[a.app_id] for a in apps]
