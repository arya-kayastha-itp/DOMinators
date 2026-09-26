"""Subprocess runner around the `terraform` CLI (T3-B-6, T3-B-7, T3-B-9).

Every step streams its output as TOOL_CALL events so a long `apply` isn't a
silent black box on the dashboard. `init`/`plan`/`apply` all use
`aws.tf_apply_env()` credentials and a shared `TF_PLUGIN_CACHE_DIR`, so `init`
doesn't re-download the AWS provider once per app.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from shutil import which

from agents.common import aws, events

REPO_ROOT = Path(__file__).resolve().parents[2]
PLUGIN_CACHE_DIR = Path(os.getenv("TF_PLUGIN_CACHE_DIR", REPO_ROOT / ".terraform-plugin-cache"))
DEFAULT_TIMEOUT_S = 300


class TerraformError(RuntimeError):
    def __init__(self, step: str, returncode: int, output: str):
        super().__init__(f"terraform {step} failed (exit {returncode}): {output[-2000:]}")
        self.step = step
        self.returncode = returncode
        self.output = output


def available() -> bool:
    return which("terraform") is not None


def _env() -> dict[str, str]:
    PLUGIN_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, **aws.tf_apply_env()}
    env["TF_PLUGIN_CACHE_DIR"] = str(PLUGIN_CACHE_DIR)
    env["TF_IN_AUTOMATION"] = "1"
    return env


def _run(app_id: str, step: str, args: list[str], cwd: Path, timeout: int = DEFAULT_TIMEOUT_S) -> str:
    if not available():
        raise TerraformError(step, -1, "terraform binary not found on PATH")
    proc = subprocess.run(
        ["terraform", *args], cwd=cwd, env=_env(), capture_output=True, text=True, timeout=timeout
    )
    output = proc.stdout + proc.stderr
    lines = output.splitlines() or [""]
    events.emit_batch(
        "blueprint", [(app_id, "TOOL_CALL", {"tool": f"terraform {step}", "line": line}) for line in lines]
    )
    if proc.returncode != 0:
        raise TerraformError(step, proc.returncode, output)
    return output


def init(app_id: str, tf_dir: Path, backend: bool = True) -> str:
    args = ["init", "-input=false"]
    if not backend:
        args.append("-backend=false")
    return _run(app_id, "init", args, tf_dir)


def validate(app_id: str, tf_dir: Path) -> dict:
    out = _run(app_id, "validate", ["validate", "-json"], tf_dir)
    return json.loads(out)


def plan(app_id: str, tf_dir: Path) -> dict:
    _run(app_id, "plan", ["plan", "-input=false", "-out=plan.out"], tf_dir)
    show = _run(app_id, "show", ["show", "-json", "plan.out"], tf_dir)
    return json.loads(show)


def apply(app_id: str, tf_dir: Path) -> str:
    return _run(app_id, "apply", ["apply", "-input=false", "plan.out"], tf_dir)


def apply_replace(app_id: str, tf_dir: Path, resource: str = "module.app.aws_instance.this") -> str:
    """T3-B-9: fix & retry. Changing `user_data` alone would only stop/start
    the instance, and user-data doesn't re-run on a restart, so a plain apply
    would silently not take effect — force a replace instead."""
    return _run(app_id, "apply", ["apply", "-input=false", "-auto-approve", f"-replace={resource}"], tf_dir)
