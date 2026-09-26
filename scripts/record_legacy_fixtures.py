"""Record Account A's raw AWS responses into fixtures/aws/ (read-only).

These are exactly the calls Discovery's scanner makes, so its tests can run
offline via botocore.Stubber. Scoped to LEGACY_VPC_IDS so unrelated workloads
in Account A are never recorded.

    python scripts/record_legacy_fixtures.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.common import aws  # noqa: E402

OUT = aws.REPO_ROOT / "fixtures" / "aws"


def _json_default(o):
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    raise TypeError(type(o))


def _save(name: str, pages: list[dict]) -> None:
    for page in pages:
        page.pop("ResponseMetadata", None)
    (OUT / f"{name}.json").write_text(json.dumps(pages, indent=2, default=_json_default) + "\n", encoding="utf-8")
    print(f"  {name}.json ({len(pages)} page(s))")


def _pages(client, op: str, **kwargs) -> list[dict]:
    if client.can_paginate(op):
        return list(client.get_paginator(op).paginate(**kwargs))
    return [getattr(client, op)(**kwargs)]


def main() -> None:
    vpc_ids = [v.strip() for v in os.environ.get("LEGACY_VPC_IDS", "").split(",") if v.strip()]
    if not vpc_ids:
        sys.exit("LEGACY_VPC_IDS is not set — refusing to record every workload in Account A")

    session = aws.legacy()
    ec2, ssm = session.client("ec2"), session.client("ssm")
    vpc_filter = [{"Name": "vpc-id", "Values": vpc_ids}]
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Recording Account A ({session.client('sts').get_caller_identity()['Account']}), VPCs {vpc_ids}")

    instances = _pages(
        ec2, "describe_instances", Filters=vpc_filter + [{"Name": "instance-state-name", "Values": ["running"]}]
    )
    _save("describe_instances", instances)
    found = [i for p in instances for r in p["Reservations"] for i in r["Instances"]]

    _save("describe_security_groups", _pages(ec2, "describe_security_groups", Filters=vpc_filter))
    _save("describe_subnets", _pages(ec2, "describe_subnets", Filters=vpc_filter))
    _save("describe_route_tables", _pages(ec2, "describe_route_tables", Filters=vpc_filter))

    instance_ids = [i["InstanceId"] for i in found]
    _save(
        "describe_volumes",
        _pages(ec2, "describe_volumes", Filters=[{"Name": "attachment.instance-id", "Values": instance_ids}]),
    )
    image_ids = sorted({i["ImageId"] for i in found})
    _save("describe_images", _pages(ec2, "describe_images", ImageIds=image_ids, IncludeDeprecated=True))

    _save("get_parameters_by_path", _pages(ssm, "get_parameters_by_path", Path="/legacy/", Recursive=True))
    print(f"Done: {len(found)} instance(s), {len(image_ids)} image(s)")


if __name__ == "__main__":
    main()
