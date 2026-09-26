"""Subprocess runner around the `terraform` CLI (T3-B-6, T3-B-7, T3-B-9).

Every step streams its output as TOOL_CALL events so a long `apply` isn't a
silent black box on the dashboard. `init`/`plan`/`apply` all use
`aws.tf_apply_env()` credentials and a shared `TF_PLUGIN_CACHE_DIR`, so `init`
doesn't re-download the AWS provider once per app.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from shutil import which

from agents.common import aws, events

REPO_ROOT = Path(__file__).resolve().parents[2]
PLUGIN_CACHE_DIR = Path(os.getenv("TF_PLUGIN_CACHE_DIR", REPO_ROOT / ".terraform-plugin-cache"))
DEFAULT_TIMEOUT_S = 300
# Apply/destroy on a slow machine: provider init + EC2 create + TG attach.
APPLY_TIMEOUT_S = 1200
STREAM_FLUSH_S = 0.5
ANSI = re.compile(r"\x1b\[[0-9;]*m")


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
    """Streams output as TOOL_CALL events while terraform runs (batched every
    STREAM_FLUSH_S), so a multi-minute apply shows progress on the dashboard
    instead of arriving all at once when it finishes. JSON output (`-json`,
    `show -json`) is one huge line; it's returned but not streamed."""
    if not available():
        raise TerraformError(step, -1, "terraform binary not found on PATH")
    stream = "-json" not in args
    proc = subprocess.Popen(
        ["terraform", *args], cwd=cwd, env=_env(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    lines: list[str] = []
    pending: list[str] = []
    last_flush = time.monotonic()
    deadline = last_flush + timeout

    def flush() -> None:
        nonlocal pending, last_flush
        if pending:
            events.emit_batch(
                "blueprint", [(app_id, "TOOL_CALL", {"tool": f"terraform {step}", "line": ln}) for ln in pending]
            )
        pending, last_flush = [], time.monotonic()

    assert proc.stdout is not None
    for raw in proc.stdout:
        line = ANSI.sub("", raw.rstrip("\n"))
        lines.append(line)
        if stream:
            pending.append(line)
            if time.monotonic() - last_flush >= STREAM_FLUSH_S:
                flush()
        if time.monotonic() > deadline:
            proc.kill()
            break
    try:
        returncode = proc.wait(timeout=max(1, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        proc.kill()
        returncode = -9
    if stream:
        flush()
    else:
        events.emit("blueprint", app_id, "TOOL_CALL", {"tool": f"terraform {step}", "line": f"({len(lines)} lines of JSON)"})
    output = "\n".join(lines)
    if returncode != 0:
        raise TerraformError(step, returncode, output)
    return output


def init(app_id: str, tf_dir: Path, backend: bool = True) -> str:
    args = ["init", "-input=false", "-no-color"]
    if not backend:
        args.append("-backend=false")
    return _run(app_id, "init", args, tf_dir, timeout=APPLY_TIMEOUT_S)


def validate(app_id: str, tf_dir: Path) -> dict:
    out = _run(app_id, "validate", ["validate", "-json"], tf_dir)
    return json.loads(out)


def plan(app_id: str, tf_dir: Path) -> dict:
    _run(app_id, "plan", ["plan", "-input=false", "-no-color", "-out=plan.out"], tf_dir, timeout=APPLY_TIMEOUT_S)
    show = _run(app_id, "show", ["show", "-json", "plan.out"], tf_dir)
    return json.loads(show)


def apply(app_id: str, tf_dir: Path) -> str:
    return _run(app_id, "apply", ["apply", "-input=false", "-no-color", "plan.out"], tf_dir, timeout=APPLY_TIMEOUT_S)


def apply_replace(app_id: str, tf_dir: Path, resource: str = "module.app.aws_instance.this") -> str:
    """T3-B-9: fix & retry. Changing `user_data` alone would only stop/start
    the instance, and user-data doesn't re-run on a restart, so a plain apply
    would silently not take effect — force a replace instead."""
    return _run(app_id, "apply", ["apply", "-input=false", "-no-color", "-auto-approve", f"-replace={resource}"],
                tf_dir, timeout=APPLY_TIMEOUT_S)


def destroy(app_id: str, tf_dir: Path) -> str:
    """Tear down what apply created (demo reset), with the same backend/creds."""
    return _run(app_id, "destroy", ["destroy", "-input=false", "-no-color", "-auto-approve"], tf_dir,
                timeout=APPLY_TIMEOUT_S)
