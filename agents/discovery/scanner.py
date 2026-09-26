"""Read-only scan of the legacy account. Clients are injected, so tests run on
recorded responses (fixtures/aws/) with no AWS access."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RawScan:
    instances: list[dict] = field(default_factory=list)
    security_groups: list[dict] = field(default_factory=list)
    volumes: list[dict] = field(default_factory=list)
    images: list[dict] = field(default_factory=list)
    subnets: list[dict] = field(default_factory=list)
    route_tables: list[dict] = field(default_factory=list)
    parameters: list[dict] = field(default_factory=list)


def _pages(client, op: str, **kwargs) -> list[dict]:
    if client.can_paginate(op):
        return list(client.get_paginator(op).paginate(**kwargs))
    return [getattr(client, op)(**kwargs)]


def _images(ec2, image_ids: list[str]) -> list[dict]:
    """Describe AMIs. The legacy AMI is deprecated, and deprecated images are
    invisible without IncludeDeprecated. One unknown/deleted image fails a batch
    call, so fall back to one call per image and let normalize() report the gap."""
    try:
        return [img for page in _pages(ec2, "describe_images", ImageIds=image_ids, IncludeDeprecated=True)
                for img in page["Images"]]
    except Exception:
        found = []
        for image_id in image_ids:
            try:
                found.extend(ec2.describe_images(ImageIds=[image_id], IncludeDeprecated=True)["Images"])
            except Exception:
                continue
        return found


def scan(ec2, ssm, vpc_ids: list[str]) -> RawScan:
    """Everything Discovery needs, scoped to `vpc_ids` (never the whole account)."""
    if not vpc_ids:
        raise ValueError("vpc_ids is empty — refusing to scan every workload in the account")
    vpc = [{"Name": "vpc-id", "Values": vpc_ids}]
    raw = RawScan()

    for page in _pages(ec2, "describe_instances", Filters=vpc + [{"Name": "instance-state-name", "Values": ["running"]}]):
        for reservation in page["Reservations"]:
            raw.instances.extend(reservation["Instances"])
    for page in _pages(ec2, "describe_security_groups", Filters=vpc):
        raw.security_groups.extend(page["SecurityGroups"])
    for page in _pages(ec2, "describe_subnets", Filters=vpc):
        raw.subnets.extend(page["Subnets"])
    for page in _pages(ec2, "describe_route_tables", Filters=vpc):
        raw.route_tables.extend(page["RouteTables"])

    instance_ids = [i["InstanceId"] for i in raw.instances]
    if instance_ids:
        for page in _pages(ec2, "describe_volumes", Filters=[{"Name": "attachment.instance-id", "Values": instance_ids}]):
            raw.volumes.extend(page["Volumes"])
        raw.images = _images(ec2, sorted({i["ImageId"] for i in raw.instances}))

    for page in _pages(ssm, "get_parameters_by_path", Path="/legacy/", Recursive=True):
        raw.parameters.extend(page["Parameters"])
    return raw
