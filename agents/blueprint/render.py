"""Renders generated/<app>/main.tf (T3-B-4).

Wiring vars (target group ARN, VPC, subnets, path prefix) come only from
target_outputs.json, never from the mapper's output — so an LLM mapper can't
point an app at the wrong target group even if it tried. Synthetic dry runs
render to a string without touching disk (`write=False`): the point is to
catch template errors at fleet scale, not to leave 1,000 folders behind.
"""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from agents.blueprint import mapper_rules
from agents.common import aws
from agents.common.models import GoldenInputs

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
GENERATED_DIR = REPO_ROOT / "generated"
DRYRUN_TG_ARN = "arn:aws:elasticloadbalancing:{region}:000000000000:targetgroup/tg-{app_id}-target/dryrun"

_env = Environment(
    loader=FileSystemLoader(TEMPLATES_DIR),
    trim_blocks=True,
    lstrip_blocks=True,
    keep_trailing_newline=True,
    # The template ships with the code and never changes mid-process; with
    # auto_reload on (the default), every render() re-stats the template file
    # to check for edits, and on a slow filesystem (see STATUS.md's OneDrive
    # note) that alone was several seconds of a 1,000-app dry run
    # (T3-B-10 needs < 30s).
    auto_reload=False,
)


def render(app_id: str, inputs: GoldenInputs, *, write: bool = True) -> tuple[str, Path]:
    outputs = aws.target_outputs()
    region = aws.region()
    target_group_arn = outputs.get("target_group_arns", {}).get(
        app_id, DRYRUN_TG_ARN.format(region=region, app_id=app_id)
    )
    template = _env.get_template("main.tf.j2")
    text = template.render(
        app_id=app_id,
        region=region,
        inputs=inputs,
        target_group_arn=target_group_arn,
        vpc_id=outputs["vpc_id"],
        private_subnet_ids=outputs["private_subnet_ids"],
        path_prefix=mapper_rules.path_prefix_for(app_id),
    )
    tf_dir = GENERATED_DIR / app_id
    if write:
        tf_dir.mkdir(parents=True, exist_ok=True)
        (tf_dir / "main.tf").write_text(text, encoding="utf-8", newline="\n")
    return text, tf_dir
