"""Deploy DOMinators to the control plane (infra/terraform/modules/control_plane).

    python scripts/deploy_control_plane.py            # build console, bundle, upload, restart
    python scripts/deploy_control_plane.py --skip-build

Steps:
  1. terraform outputs (envs/target) -> releases bucket, instance id, SSM prefix, URL
  2. static console build (STATIC_EXPORT=1, NEXT_PUBLIC_API_BASE=/api) -> console/out
  3. bundle only what the box runs (never .env, the state DB or generated/)
  4. the box's .env -> SSM SecureString (laptop-only settings dropped, terraform
     via mig-tf-apply instead of a profile, operator key created once and reused)
  5. upload the bundle, run `dominators-deploy` on the box through SSM, wait
  6. GET <url>/api/healthz

Needs: terraform on PATH, AWS access to Account B (TARGET_PROFILE), node_modules
installed in migration-accelerator-console.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import secrets
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

import boto3
from dotenv import dotenv_values, load_dotenv

ROOT = Path(__file__).resolve().parents[1]
CONSOLE = ROOT / "migration-accelerator-console"
TF_ENV = ROOT / "infra" / "terraform" / "envs" / "target"

# What the box needs, relative to the repo root (directories are walked).
BUNDLE = [
    "agents", "orchestrator", "app", "infra/terraform/modules",
    "data/fleet.json", "data/target_outputs.json", "requirements.txt",
    "migration-accelerator-console/out",
]
SKIP_PARTS = {"__pycache__", ".pytest_cache", "tests", ".terraform", "cache"}
SKIP_SUFFIXES = {".pyc", ".tfstate", ".tfplan"}

# .env keys that only make sense on a laptop, and what the box uses instead.
DROP = {"AWS_CA_BUNDLE", "TARGET_PROFILE", "TF_APPLY_USE_PROFILE", "CORS_ORIGINS", "LLM_LIVE"}
BOX = {
    "TARGET_PROFILE": "",                      # instance role (default credential chain)
    "TF_APPLY_USE_PROFILE": "0",               # terraform through mig-tf-apply
    "MIG_STORE_PATH": "/opt/dominators/data/state.db",
    "TF_PLUGIN_CACHE_DIR": "/opt/dominators/data/tf-plugin-cache",
}


def log(msg: str) -> None:
    print(f"==> {msg}", flush=True)


def tf_outputs() -> dict:
    out = subprocess.run(["terraform", "output", "-json"], cwd=TF_ENV, capture_output=True, text=True, check=True)
    raw = json.loads(out.stdout)
    need = ["control_plane_releases_bucket", "control_plane_instance_id", "control_plane_ssm_prefix", "control_plane_url"]
    missing = [k for k in need if k not in raw]
    if missing:
        sys.exit(f"terraform outputs missing {missing}: apply envs/target with the control_plane module first")
    return {k: raw[k]["value"] for k in need}


def build_console() -> None:
    log("building the static console (STATIC_EXPORT=1, API at /api)")
    env = {**os.environ, "STATIC_EXPORT": "1", "NEXT_PUBLIC_API_BASE": "/api", "NEXT_TELEMETRY_DISABLED": "1"}
    next_bin = CONSOLE / "node_modules" / ".bin" / ("next.cmd" if os.name == "nt" else "next")
    subprocess.run([str(next_bin), "build"], cwd=CONSOLE, env=env, check=True)
    if not (CONSOLE / "out" / "index.html").exists():
        sys.exit("console build produced no out/index.html")


def bundle() -> bytes:
    buf = io.BytesIO()
    n = 0
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel in BUNDLE:
            src = ROOT / rel
            if not src.exists():
                sys.exit(f"missing {rel}")
            files = [src] if src.is_file() else [p for p in src.rglob("*") if p.is_file()]
            for f in files:
                parts = set(f.relative_to(ROOT).parts)
                if parts & SKIP_PARTS or f.suffix in SKIP_SUFFIXES or f.name == "trace":
                    continue
                tar.add(f, arcname=f.relative_to(ROOT).as_posix())
                n += 1
    log(f"bundled {n} files ({buf.tell() / 1e6:.1f} MB)")
    return buf.getvalue()


def box_env(ssm, prefix: str) -> str:
    local = {k: v for k, v in dotenv_values(ROOT / ".env").items() if v is not None}
    env = {k: v for k, v in local.items() if k not in DROP}
    env.update(BOX)
    try:
        key = ssm.get_parameter(Name=f"{prefix}/operator_key", WithDecryption=True)["Parameter"]["Value"]
    except ssm.exceptions.ParameterNotFound:
        key = secrets.token_urlsafe(18)
        ssm.put_parameter(Name=f"{prefix}/operator_key", Value=key, Type="SecureString",
                          Description="DOMinators operator key (unlocks actions in the console)")
        log(f"created a new operator key in SSM {prefix}/operator_key")
    env["OPERATOR_KEY"] = key
    return "\n".join(f"{k}={v}" for k, v in env.items()) + "\n"


def run_on_box(ssm, instance_id: str, timeout_s: int = 900) -> None:
    log(f"running dominators-deploy on {instance_id} via SSM")
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            cmd = ssm.send_command(
                InstanceIds=[instance_id], DocumentName="AWS-RunShellScript",
                Parameters={"commands": [
                    # First boot: wait for the bootstrap to install the deploy script.
                    "for i in $(seq 1 90); do [ -x /usr/local/bin/dominators-deploy ] && break; sleep 10; done",
                    "/usr/local/bin/dominators-deploy",
                ]},
                TimeoutSeconds=timeout_s,
            )["Command"]["CommandId"]
            break
        except ssm.exceptions.InvalidInstanceId:
            if time.monotonic() > deadline:
                raise
            log("instance not registered with SSM yet — waiting")
            time.sleep(15)
    while True:
        time.sleep(5)
        try:
            inv = ssm.get_command_invocation(CommandId=cmd, InstanceId=instance_id)
        except ssm.exceptions.InvocationDoesNotExist:
            continue
        if inv["Status"] in ("Pending", "InProgress", "Delayed"):
            continue
        out = (inv.get("StandardOutputContent") or "")[-1500:]
        err = (inv.get("StandardErrorContent") or "")[-1500:]
        print(out)
        if inv["Status"] != "Success":
            print(err, file=sys.stderr)
            sys.exit(f"dominators-deploy {inv['Status']}")
        return


def wait_healthy(url: str, timeout_s: int = 300) -> None:
    log(f"waiting for {url}/api/healthz")
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/api/healthz", timeout=10) as r:
                body = json.loads(r.read())
                if body.get("ok"):
                    log(f"healthy: {body}")
                    return
        except Exception:  # noqa: BLE001 - CloudFront / ALB warming up
            pass
        time.sleep(10)
    sys.exit("control plane did not become healthy in time")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-build", action="store_true", help="reuse migration-accelerator-console/out")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    session = boto3.Session(profile_name=os.getenv("TARGET_PROFILE", "mig-target") or None,
                            region_name=os.getenv("AWS_REGION", "ap-south-1"))
    ssm, s3 = session.client("ssm"), session.client("s3")

    out = tf_outputs()
    if not args.skip_build:
        build_console()
    blob = bundle()

    log(f"writing the box's .env to SSM {out['control_plane_ssm_prefix']}/env")
    ssm.put_parameter(Name=f"{out['control_plane_ssm_prefix']}/env", Value=box_env(ssm, out["control_plane_ssm_prefix"]),
                      Type="SecureString", Overwrite=True)

    stamp = time.strftime("%Y%m%d-%H%M%S")
    bucket = out["control_plane_releases_bucket"]
    for key in (f"releases/{stamp}.tar.gz", "releases/current.tar.gz"):
        s3.put_object(Bucket=bucket, Key=key, Body=blob)
    log(f"uploaded s3://{bucket}/releases/current.tar.gz ({stamp})")

    run_on_box(ssm, out["control_plane_instance_id"])
    wait_healthy(out["control_plane_url"])
    log(f"live at {out['control_plane_url']}  (operator key: SSM {out['control_plane_ssm_prefix']}/operator_key)")


if __name__ == "__main__":
    main()
