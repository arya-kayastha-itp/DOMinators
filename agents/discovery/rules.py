"""The 10 finding rules, as pure functions of an AppRecord's raw fields.

The legacy instances' `findings` tag is a test oracle only; nothing here reads it.
"""

from __future__ import annotations

import re
from collections.abc import Callable

from agents.common.models import AppRecord, FindingCode
from agents.discovery.normalize import ANY_PORT

OPEN_CIDRS = {"0.0.0.0/0", "::/0"}
REQUIRED_TAGS = ("owner", "cost-center", "data-class")
DB_PORTS = {1433, 1521, 3306, 5432, 6379, 27017}
LARGE_EXTRA_VOLUME_GB = 50
OLD_AMI_DAYS = 365
IPV4 = re.compile(r"(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])")


def _open_on(app: AppRecord, port: int | None) -> bool:
    return port is not None and any(
        r.cidr in OPEN_CIDRS and r.port in (port, ANY_PORT) for r in app.network.sg_ingress
    )


def sg_open_ssh(app: AppRecord) -> bool:
    return _open_on(app, 22)


def sg_open_app(app: AppRecord) -> bool:
    return _open_on(app, app.runtime.port)


def ebs_unencrypted(app: AppRecord) -> bool:
    return not app.storage.ebs_encrypted


def imdsv1(app: AppRecord) -> bool:
    return not app.metadata.imds_v2_required


def old_ami(app: AppRecord) -> bool:
    # An AMI we can't describe is reported, never silently skipped.
    return app.runtime.ami_age_days is None or app.runtime.ami_age_days > OLD_AMI_DAYS


def no_vpc_segmentation(app: AppRecord) -> bool:
    return not app.network.vpc_has_private_subnet


def public_ip(app: AppRecord) -> bool:
    return app.network.public_ip


def missing_tags(app: AppRecord) -> bool:
    return any(not app.tags.get(t) for t in REQUIRED_TAGS)


def hardcoded_ip(app: AppRecord) -> bool:
    return any(IPV4.search(v) for v in app.config.env.values())


def stateful(app: AppRecord) -> bool:
    db_port_open = any(r.port in DB_PORTS for r in app.network.sg_ingress)
    return app.runtime.stateful or db_port_open or app.storage.extra_volume_gb >= LARGE_EXTRA_VOLUME_GB


RULES: dict[FindingCode, Callable[[AppRecord], bool]] = {
    FindingCode.SG_OPEN_SSH: sg_open_ssh,
    FindingCode.SG_OPEN_APP: sg_open_app,
    FindingCode.EBS_UNENCRYPTED: ebs_unencrypted,
    FindingCode.IMDSV1: imdsv1,
    FindingCode.OLD_AMI: old_ami,
    FindingCode.NO_VPC_SEGMENTATION: no_vpc_segmentation,
    FindingCode.PUBLIC_IP: public_ip,
    FindingCode.MISSING_TAGS: missing_tags,
    FindingCode.HARDCODED_IP: hardcoded_ip,
    FindingCode.STATEFUL: stateful,
}


def evaluate(app: AppRecord) -> list[FindingCode]:
    return [code for code, rule in RULES.items() if rule(app)]


def apply(apps: list[AppRecord]) -> list[AppRecord]:
    return [a.model_copy(update={"findings": evaluate(a)}) for a in apps]
