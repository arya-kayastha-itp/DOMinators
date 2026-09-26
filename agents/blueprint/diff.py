"""Before/after diff with per-finding annotations (T3-B-5).

Before = a readable summary of the raw legacy facts (SG rules, encryption,
IMDS, AMI, subnet, tags, env), built straight from the AppRecord. After = the
rendered Terraform. Every finding the app actually has gets one annotation,
pointing at the line in "before" that shows the problem and (for OLD_AMI
only) the line in "after" that fixes it — every other fix lives in the
golden_app module itself, off the page.
"""

from __future__ import annotations

from agents.common.models import Annotation, AppRecord, Diff, FindingCode, Fix

OPEN_CIDRS = {"0.0.0.0/0", "::/0"}

FIX_MAP: dict[FindingCode, str] = {
    FindingCode.SG_OPEN_SSH: "No port 22; SSM Session Manager",
    FindingCode.SG_OPEN_APP: "Ingress from the edge ALB security group only",
    FindingCode.EBS_UNENCRYPTED: "KMS-encrypted gp3 (alias/mig-ebs)",
    FindingCode.IMDSV1: "http_tokens = required (IMDSv2)",
    FindingCode.OLD_AMI: "Latest AL2023 AMI from the public SSM parameter",
    FindingCode.NO_VPC_SEGMENTATION: "Placed in the target VPC's private-subnet tier",
    FindingCode.PUBLIC_IP: "Private subnet, no public IP",
    FindingCode.MISSING_TAGS: "Required tags enforced; gaps flagged",
    FindingCode.HARDCODED_IP: "UPSTREAM_URL rewritten to the ALB path",
}


def _before(app: AppRecord) -> tuple[str, dict[FindingCode, int]]:
    findings = set(app.findings)
    lines = [f"# {app.app_id} (legacy, Account A)"]
    at: dict[FindingCode, int] = {}

    if app.runtime.ami_age_days is not None:
        age = f"{app.runtime.ami_age_days}d old"
    else:
        age = app.runtime.ami_age_reason or "age unknown"
    lines.append(f"instance      {app.runtime.instance_type or 'unknown'}, AMI {app.runtime.ami_id or 'unknown'} ({age})")
    if FindingCode.OLD_AMI in findings:
        at[FindingCode.OLD_AMI] = len(lines)

    for rule in app.network.sg_ingress:
        port = "all" if rule.port == -1 else str(rule.port)
        source = rule.cidr if rule.cidr else f"sg {rule.source_sg}"
        lines.append(f"ingress       {port}/tcp from {source}")
        world_open = rule.cidr in OPEN_CIDRS
        if world_open and rule.port in (22, -1) and FindingCode.SG_OPEN_SSH not in at:
            at[FindingCode.SG_OPEN_SSH] = len(lines)
        if world_open and rule.port in (app.runtime.port, -1) and FindingCode.SG_OPEN_APP not in at:
            at[FindingCode.SG_OPEN_APP] = len(lines)

    lines.append(f"root volume   {app.storage.volume_gb} GiB gp2, encrypted = {str(app.storage.ebs_encrypted).lower()}")
    if FindingCode.EBS_UNENCRYPTED in findings:
        at[FindingCode.EBS_UNENCRYPTED] = len(lines)

    metadata = "IMDSv2 required" if app.metadata.imds_v2_required else "IMDSv1 allowed (http_tokens = optional)"
    lines.append(f"metadata      {metadata}")
    if FindingCode.IMDSV1 in findings:
        at[FindingCode.IMDSV1] = len(lines)

    subnet = "public, public IP assigned" if app.network.public_ip else ("public" if app.network.subnet_public else "private")
    lines.append(f"subnet        {subnet}")
    if FindingCode.PUBLIC_IP in findings:
        at[FindingCode.PUBLIC_IP] = len(lines)

    vpc = "no private-subnet tier (every route table -> IGW)" if not app.network.vpc_has_private_subnet else "private-subnet tier present"
    lines.append(f"vpc           {vpc}")
    if FindingCode.NO_VPC_SEGMENTATION in findings:
        at[FindingCode.NO_VPC_SEGMENTATION] = len(lines)

    if FindingCode.MISSING_TAGS in findings:
        missing = [t for t in ("owner", "cost-center", "data-class") if not app.tags.get(t)]
        lines.append(f"tags          missing: {', '.join(missing)}")
        at[FindingCode.MISSING_TAGS] = len(lines)

    if FindingCode.HARDCODED_IP in findings:
        env_line = ", ".join(f"{k}={v}" for k, v in app.config.env.items())
        lines.append(f"env           {env_line}")
        at[FindingCode.HARDCODED_IP] = len(lines)

    return "\n".join(lines), at


def build(app: AppRecord, rendered_tf: str) -> tuple[Diff, list[Fix]]:
    before, before_lines = _before(app)
    present = [f for f in app.findings if f in FIX_MAP]

    after_lines = rendered_tf.splitlines()
    ami_line = next((i + 1 for i, line in enumerate(after_lines) if "source " in line and "golden_app" in line), None)

    annotations = [
        Annotation(
            finding=f,
            before_line=before_lines.get(f),
            after_line=ami_line if f == FindingCode.OLD_AMI else None,
            fix=FIX_MAP[f],
        )
        for f in present
    ]
    fixes = [Fix(finding=f, fix=FIX_MAP[f]) for f in present]
    return Diff(before=before, after=rendered_tf, annotations=annotations), fixes
