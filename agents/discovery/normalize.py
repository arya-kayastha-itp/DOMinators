"""Raw scan -> one AppRecord per app (findings are computed later by rules.py)."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone

from agents.common.models import (
    AppRecord,
    Config,
    Metadata,
    Network,
    Runtime,
    SgRule,
    Source,
    Storage,
)
from agents.discovery.scanner import RawScan

ANY_PORT = -1  # all-traffic or port-range rules; the rules treat it as matching every port


def _tags(resource: dict) -> dict[str, str]:
    return {t["Key"]: t["Value"] for t in resource.get("Tags", []) if not t["Key"].startswith("aws:")}


def _parse_ts(value) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _has_igw_default(route_table: dict) -> bool:
    return any(
        r.get("DestinationCidrBlock") == "0.0.0.0/0" and str(r.get("GatewayId", "")).startswith("igw-")
        for r in route_table.get("Routes", [])
    )


def _effective_route_tables(raw: RawScan) -> dict[str, dict]:
    """subnet_id -> the route table it actually uses: its explicit association,
    else its VPC's main table."""
    explicit, main = {}, {}
    for rt in raw.route_tables:
        for assoc in rt.get("Associations", []):
            if assoc.get("SubnetId"):
                explicit[assoc["SubnetId"]] = rt
            if assoc.get("Main"):
                main[rt["VpcId"]] = rt
    return {s["SubnetId"]: explicit.get(s["SubnetId"], main.get(s["VpcId"], {})) for s in raw.subnets}


def _vpcs_with_private_subnet(raw: RawScan, effective: dict[str, dict]) -> set[str]:
    return {s["VpcId"] for s in raw.subnets if not _has_igw_default(effective.get(s["SubnetId"], {}))}


def _ingress(group: dict) -> list[SgRule]:
    rules = []
    for perm in group.get("IpPermissions", []):
        lo, hi = perm.get("FromPort"), perm.get("ToPort")
        port = lo if (perm.get("IpProtocol") != "-1" and lo is not None and lo == hi) else ANY_PORT
        for r in perm.get("IpRanges", []):
            rules.append(SgRule(port=port, cidr=r["CidrIp"]))
        for r in perm.get("Ipv6Ranges", []):
            rules.append(SgRule(port=port, cidr=r["CidrIpv6"]))
        for pair in perm.get("UserIdGroupPairs", []):
            rules.append(SgRule(port=port, source_sg=pair["GroupId"]))
    return rules


def _app_port(rules: list[SgRule]) -> int | None:
    """The app port = the most common port the SGs open, other than 22."""
    counts = Counter(r.port for r in rules if r.port not in (22, ANY_PORT))
    return counts.most_common(1)[0][0] if counts else None


def normalize(raw: RawScan, now: datetime | None = None) -> list[AppRecord]:
    now = now or datetime.now(timezone.utc)
    groups: dict[str, list[dict]] = defaultdict(list)
    for inst in raw.instances:
        tags = _tags(inst)
        key = tags.get("app") or tags.get("Name")
        if key:
            groups[key].append(inst)

    images = {img["ImageId"]: img for img in raw.images}
    sgs = {g["GroupId"]: g for g in raw.security_groups}
    subnets = {s["SubnetId"]: s for s in raw.subnets}
    effective = _effective_route_tables(raw)
    private_vpcs = _vpcs_with_private_subnet(raw, effective)
    volumes_by_instance: dict[str, list[tuple[dict, str]]] = defaultdict(list)
    for vol in raw.volumes:
        for att in vol.get("Attachments", []):
            volumes_by_instance[att["InstanceId"]].append((vol, att.get("Device", "")))
    env_by_app: dict[str, dict[str, str]] = defaultdict(dict)
    for p in raw.parameters:
        parts = p["Name"].strip("/").split("/")  # legacy/<app>/<KEY>
        if len(parts) >= 3:
            env_by_app[parts[1]][parts[-1]] = p["Value"]

    apps = []
    for app_id, instances in sorted(groups.items()):
        first = instances[0]
        tags: dict[str, str] = {}
        for inst in instances:
            tags.update(_tags(inst))

        sg_ids = sorted({g["GroupId"] for inst in instances for g in inst.get("SecurityGroups", [])})
        rules = [rule for sg_id in sg_ids for rule in _ingress(sgs.get(sg_id, {}))]

        ami_id = first.get("ImageId")
        image = images.get(ami_id)
        if image and image.get("CreationDate"):
            ami_age, ami_reason = (now - _parse_ts(image["CreationDate"])).days, None
        else:
            ami_age, ami_reason = None, f"AMI {ami_id} could not be described (deleted, or not visible to this account)"

        vols = [v for inst in instances for v in volumes_by_instance.get(inst["InstanceId"], [])]
        root_devices = {inst.get("RootDeviceName") for inst in instances}
        root = [v for v, dev in vols if dev in root_devices]
        extra = [v for v, dev in vols if dev not in root_devices]

        subnet_id = first.get("SubnetId")
        subnet_rt = effective.get(subnet_id, {})
        subnet = subnets.get(subnet_id, {})

        apps.append(AppRecord(
            app_id=app_id,
            source=Source.REAL,
            name=tags.get("Name", app_id),
            owner=tags.get("owner"),
            business_unit=tags.get("business-unit") or tags.get("business_unit"),
            runtime=Runtime(
                type="ec2",
                instance_ids=[i["InstanceId"] for i in instances],
                ami_id=ami_id,
                ami_age_days=ami_age,
                ami_age_reason=ami_reason,
                instance_type=first.get("InstanceType"),
                port=_app_port(rules),
                stateful=tags.get("stateful", "").lower() == "true",
            ),
            network=Network(
                vpc_id=first.get("VpcId"),
                vpc_has_private_subnet=first.get("VpcId") in private_vpcs,
                subnet_public=_has_igw_default(subnet_rt) or bool(subnet.get("MapPublicIpOnLaunch")),
                public_ip=any(i.get("PublicIpAddress") for i in instances),
                private_ip=first.get("PrivateIpAddress"),
                sg_ids=sg_ids,
                sg_ingress=rules,
            ),
            storage=Storage(
                ebs_encrypted=all(v.get("Encrypted", False) for v, _ in vols),
                volume_gb=sum(v.get("Size", 0) for v in root) or (vols[0][0].get("Size", 8) if vols else 8),
                extra_volume_gb=sum(v.get("Size", 0) for v in extra),
            ),
            metadata=Metadata(
                imds_v2_required=all(i.get("MetadataOptions", {}).get("HttpTokens") == "required" for i in instances)
            ),
            config=Config(env=env_by_app.get(app_id, {})),
            license=tags.get("license") if tags.get("license") in ("commercial", "byol") else "none",
            tags=tags,
        ))
    return apps
