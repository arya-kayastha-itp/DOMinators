"""Real ALB weight control (T3-C-3): `elbv2.modify_rule` / `describe_rules`.

Every function takes an explicit `elbv2` client, so the exact same code runs
against the real ALB (`aws.agent_runner().client("elbv2")`) or
`agents/cutover/fake_alb.py`'s `FakeElbClient` — same describe_rules /
modify_rule / describe_target_health shape, no code change either way. ARNs
only ever come from `target_outputs.json` (never constructed), and a
mutating call is guarded by `assert_managed` first.
"""

from __future__ import annotations

from agents.common import aws


def _rule_arn(app_id: str) -> str:
    arn = aws.target_outputs().get("listener_rule_arns", {}).get(app_id)
    if not arn:
        raise KeyError(f"no listener_rule_arns[{app_id!r}] in target_outputs.json")
    return arn


def _tg_arns(app_id: str) -> tuple[str, str]:
    outputs = aws.target_outputs()
    legacy = outputs.get("legacy_target_group_arns", {}).get(app_id)
    target = outputs.get("target_group_arns", {}).get(app_id)
    if not legacy or not target:
        raise KeyError(f"no target group ARNs for {app_id!r} in target_outputs.json")
    return legacy, target


def set_weights(elbv2, app_id: str, target_pct: int, *, assert_managed=aws.assert_managed, session=None) -> None:
    if not 0 <= target_pct <= 100:
        raise ValueError(f"target_pct must be 0-100, got {target_pct}")
    rule_arn = _rule_arn(app_id)
    # session is only resolved (and only ever needs a real AWS profile) if the
    # caller didn't already supply one — a no-op assert_managed (fake ALB,
    # tests) never touches aws.target() at all.
    if session is not None:
        assert_managed(rule_arn, session=session)
    else:
        assert_managed(rule_arn)
    legacy_arn, target_arn = _tg_arns(app_id)
    elbv2.modify_rule(
        RuleArn=rule_arn,
        Actions=[{
            "Type": "forward",
            "ForwardConfig": {
                "TargetGroups": [
                    {"TargetGroupArn": legacy_arn, "Weight": 100 - target_pct},
                    {"TargetGroupArn": target_arn, "Weight": target_pct},
                ]
            },
        }],
    )


def get_weights(elbv2, app_id: str) -> dict[str, int]:
    rule_arn = _rule_arn(app_id)
    legacy_arn, target_arn = _tg_arns(app_id)
    rule = elbv2.describe_rules(RuleArns=[rule_arn])["Rules"][0]
    weights: dict[str, int] = {}
    for action in rule["Actions"]:
        if action["Type"] != "forward":
            continue
        for tg in action["ForwardConfig"]["TargetGroups"]:
            if tg["TargetGroupArn"] == legacy_arn:
                weights["legacy"] = tg["Weight"]
            elif tg["TargetGroupArn"] == target_arn:
                weights["target"] = tg["Weight"]
    return weights


def target_healthy(elbv2, app_id: str) -> bool:
    _, target_arn = _tg_arns(app_id)
    descriptions = elbv2.describe_target_health(TargetGroupArn=target_arn)["TargetHealthDescriptions"]
    return bool(descriptions) and all(d["TargetHealth"]["State"] == "healthy" for d in descriptions)
