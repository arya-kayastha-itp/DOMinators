"""AWS sessions for the agents. Nothing about either account is hardcoded:
role ARNs, ExternalId, profile and region come from the environment (.env).

- target()        Account B, from TARGET_PROFILE
- agent_runner()  Account B, assumes AGENT_RUNNER_ROLE_ARN
- legacy()        Account A, two hops: agent_runner -> LEGACY_ROLE_ARN (+ LEGACY_EXTERNAL_ID)

Assumed-role credentials refresh themselves before they expire (role chaining
caps them at 1 h), so long-running agents never hit an expired token.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import boto3
from botocore.credentials import RefreshableCredentials
from botocore.session import get_session
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
MANAGED_TAG = ("managed-by", "migration-accelerator")

load_dotenv(REPO_ROOT / ".env")


class NotManagedError(PermissionError):
    """A mutating action targeted a resource without the managed-by tag."""


def _env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if not value:
        raise RuntimeError(f"{name} is not set — copy .env.example to .env and fill it in")
    return value


def region() -> str:
    return _env("AWS_REGION", "ap-south-1")


def _assumed(parent: boto3.Session, role_arn: str, session_name: str, external_id: str | None = None) -> boto3.Session:
    def fetch() -> dict:
        params = {"RoleArn": role_arn, "RoleSessionName": session_name, "DurationSeconds": 3600}
        if external_id:
            params["ExternalId"] = external_id
        c = parent.client("sts").assume_role(**params)["Credentials"]
        return {
            "access_key": c["AccessKeyId"],
            "secret_key": c["SecretAccessKey"],
            "token": c["SessionToken"],
            "expiry_time": c["Expiration"].isoformat(),
        }

    creds = RefreshableCredentials.create_from_metadata(
        metadata=fetch(), refresh_using=fetch, method="sts-assume-role"
    )
    core = get_session()
    core._credentials = creds
    core.set_config_variable("region", region())
    return boto3.Session(botocore_session=core)


@lru_cache(maxsize=1)
def target() -> boto3.Session:
    return boto3.Session(profile_name=_env("TARGET_PROFILE", "mig-target"), region_name=region())


@lru_cache(maxsize=1)
def agent_runner() -> boto3.Session:
    return _assumed(target(), _env("AGENT_RUNNER_ROLE_ARN"), "mig-agent-runner")


@lru_cache(maxsize=1)
def legacy() -> boto3.Session:
    return _assumed(
        agent_runner(), _env("LEGACY_ROLE_ARN"), "mig-discovery", external_id=_env("LEGACY_EXTERNAL_ID")
    )


def tf_apply_env() -> dict[str, str]:
    """Env vars for a `terraform` subprocess.

    Uses TF_APPLY_ROLE_ARN when set; otherwise the target profile (mig-tf-apply
    still lacks iam:PassRole on mig-app-instance — checklist T1-2).
    """
    env = {"AWS_REGION": region(), "AWS_DEFAULT_REGION": region()}
    role = os.getenv("TF_APPLY_ROLE_ARN")
    if not role or os.getenv("TF_APPLY_USE_PROFILE") == "1":
        env["AWS_PROFILE"] = _env("TARGET_PROFILE", "mig-target")
        return env
    creds = _assumed(target(), role, "mig-tf-apply").get_credentials().get_frozen_credentials()
    env.update(
        AWS_ACCESS_KEY_ID=creds.access_key,
        AWS_SECRET_ACCESS_KEY=creds.secret_key,
        AWS_SESSION_TOKEN=creds.token,
    )
    return env


@lru_cache(maxsize=1)
def target_outputs() -> dict:
    """data/target_outputs.json flattened to {output_name: value}. Tolerates a BOM."""
    path = Path(os.getenv("TARGET_OUTPUTS_PATH", REPO_ROOT / "data" / "target_outputs.json"))
    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    return {k: (v["value"] if isinstance(v, dict) and "value" in v else v) for k, v in raw.items()}


def assert_managed(arn: str, session: boto3.Session | None = None) -> None:
    """Raise NotManagedError unless the resource carries managed-by=migration-accelerator."""
    tagging = (session or target()).client("resourcegroupstaggingapi")
    found = tagging.get_resources(ResourceARNList=[arn])["ResourceTagMappingList"]
    tags = {t["Key"]: t["Value"] for m in found for t in m.get("Tags", [])}
    if tags.get(MANAGED_TAG[0]) != MANAGED_TAG[1]:
        raise NotManagedError(f"{arn} is not tagged {MANAGED_TAG[0]}={MANAGED_TAG[1]}")
