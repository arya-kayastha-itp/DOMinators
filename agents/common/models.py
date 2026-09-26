"""Pydantic models for every shape in docs/CONTRACTS.md (including the addendum).

Frozen at G0: a shape change needs the contract owner's sign-off plus a
fixture update in the same PR.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    def to_json(self) -> str:
        return self.model_dump_json(by_alias=True)

    def to_dict(self) -> dict:
        return self.model_dump(mode="json", by_alias=True)


# ---------------------------------------------------------------- enums


class Source(StrEnum):
    REAL = "real"
    SYNTHETIC = "synthetic"


class Tier(StrEnum):
    GOLDEN = "GOLDEN"
    GRAY = "GRAY"
    RED = "RED"


class DecidedBy(StrEnum):
    RULES = "rules"
    LLM = "llm"


class AppStatus(StrEnum):
    """Lifecycle from docs/FLOW.md §2."""

    DISCOVERED = "DISCOVERED"
    TIERED = "TIERED"
    PLANNED = "PLANNED"
    PARKED = "PARKED"
    BLUEPRINTED = "BLUEPRINTED"
    PROVISIONED = "PROVISIONED"
    FAILED = "FAILED"
    CUTTING_OVER = "CUTTING_OVER"
    MIGRATED = "MIGRATED"
    ROLLED_BACK = "ROLLED_BACK"


class FindingCode(StrEnum):
    SG_OPEN_SSH = "SG_OPEN_SSH"
    SG_OPEN_APP = "SG_OPEN_APP"
    EBS_UNENCRYPTED = "EBS_UNENCRYPTED"
    IMDSV1 = "IMDSV1"
    OLD_AMI = "OLD_AMI"
    NO_VPC_SEGMENTATION = "NO_VPC_SEGMENTATION"
    PUBLIC_IP = "PUBLIC_IP"
    MISSING_TAGS = "MISSING_TAGS"
    HARDCODED_IP = "HARDCODED_IP"
    STATEFUL = "STATEFUL"


class EdgeSignal(StrEnum):
    TAG = "tag"
    SSM = "ssm"
    ENV = "env"
    SG_REF = "sg_ref"
    FLOW_LOG = "flow_log"
    SYNTHETIC = "synthetic"


class EventType(StrEnum):
    DISCOVERY_STARTED = "DISCOVERY_STARTED"
    APP_DISCOVERED = "APP_DISCOVERED"
    DISCOVERY_DONE = "DISCOVERY_DONE"
    PLAN_DONE = "PLAN_DONE"
    BLUEPRINT_READY = "BLUEPRINT_READY"
    BLUEPRINT_DRY_RUN = "BLUEPRINT_DRY_RUN"
    PROVISIONED = "PROVISIONED"
    CUTOVER_STARTED = "CUTOVER_STARTED"
    WEIGHT_SET = "WEIGHT_SET"
    GATE_PASS = "GATE_PASS"
    GATE_FAIL = "GATE_FAIL"
    ROLLED_BACK = "ROLLED_BACK"
    MIGRATED = "MIGRATED"
    SIM_DATA_MIGRATION = "SIM_DATA_MIGRATION"
    SIM_DECOMMISSION = "SIM_DECOMMISSION"
    SIM_LICENSE_FLAG = "SIM_LICENSE_FLAG"
    SIM_NOTIFY = "SIM_NOTIFY"
    TOOL_CALL = "TOOL_CALL"
    LLM_FALLBACK = "LLM_FALLBACK"
    BLUEPRINT_FAILED = "BLUEPRINT_FAILED"
    CUTOVER_ABORTED = "CUTOVER_ABORTED"
    ERROR = "ERROR"


class CutoverResult(StrEnum):
    MIGRATED = "MIGRATED"
    ROLLED_BACK = "ROLLED_BACK"
    ABORTED = "ABORTED"


class Gate(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"


class ServedBy(StrEnum):
    LEGACY = "legacy"
    TARGET = "target"
    UNKNOWN = "unknown"


EventLevel = Literal["info", "warn", "error"]
RuntimeType = Literal["ec2", "ecs", "unknown"]
License = Literal["none", "commercial", "byol"]


# ---------------------------------------------------------------- AppRecord


class Runtime(_Model):
    type: RuntimeType = "ec2"
    instance_ids: list[str] = Field(default_factory=list)
    ami_id: str | None = None
    ami_age_days: int | None = None
    # Why ami_age_days is None when the image couldn't be described (never skip OLD_AMI silently).
    ami_age_reason: str | None = None
    instance_type: str | None = None
    port: int | None = None
    stateful: bool = False


class SgRule(_Model):
    port: int
    cidr: str | None = None
    # Source security group, for the "provider SG allows the consumer's SG" dependency signal.
    source_sg: str | None = None


class Network(_Model):
    vpc_id: str | None = None
    vpc_has_private_subnet: bool = False
    subnet_public: bool = False
    public_ip: bool = False
    private_ip: str | None = None
    sg_ids: list[str] = Field(default_factory=list)
    sg_ingress: list[SgRule] = Field(default_factory=list)


class Storage(_Model):
    ebs_encrypted: bool = False
    volume_gb: int = 8
    # Size of any non-root volumes; a large one is a STATEFUL signal.
    extra_volume_gb: int = 0


class Metadata(_Model):
    imds_v2_required: bool = False


class Config(_Model):
    env: dict[str, str] = Field(default_factory=dict)


class AppRecord(_Model):
    app_id: str
    source: Source
    name: str
    owner: str | None = None
    business_unit: str | None = None
    runtime: Runtime = Field(default_factory=Runtime)
    network: Network = Field(default_factory=Network)
    storage: Storage = Field(default_factory=Storage)
    metadata: Metadata = Field(default_factory=Metadata)
    config: Config = Field(default_factory=Config)
    license: License = "none"
    depends_on: list[str] = Field(default_factory=list)
    tags: dict[str, str] = Field(default_factory=dict)
    findings: list[FindingCode] = Field(default_factory=list)
    status: AppStatus = AppStatus.DISCOVERED


# ---------------------------------------------------------------- Discovery outputs


class Tiering(_Model):
    app_id: str
    tier: Tier
    score: int
    reasons: list[str] = Field(default_factory=list)
    risk_summary: str = ""
    decided_by: DecidedBy = DecidedBy.RULES


class Edge(_Model):
    """Always consumer -> provider."""

    from_: str = Field(alias="from")
    to: str
    signals: list[EdgeSignal]
    source: Source


class DiscoverySummary(_Model):
    apps_total: int
    real: int
    synthetic: int
    tiers: dict[Tier, int]
    findings: dict[FindingCode, int]
    edges: int
    llm_decisions: int = 0
    duration_ms: int


# ---------------------------------------------------------------- Planning


class Wave(_Model):
    wave: int
    name: str | None = None
    start: date
    app_ids: list[str]
    tier_mix: dict[Tier, int] = Field(default_factory=dict)
    rationale: str | None = None


class Projection(_Model):
    apps_total: int
    apps_schedulable: int
    projected_finish: date | None
    apps_per_day: float
    meets_target_2027: bool


class WavePlan(_Model):
    plan_id: str
    generated_at: datetime
    capacity_per_wave: int
    waves_per_week: int
    waves: list[Wave]
    parked: list[str] = Field(default_factory=list)
    projection: Projection


# ---------------------------------------------------------------- Blueprint


class GoldenInputs(_Model):
    name: str
    port: int
    instance_type: str
    env: dict[str, str] = Field(default_factory=dict)
    tags: dict[str, str] = Field(default_factory=dict)
    # golden_app install template (infra/terraform app_routes[app].runtime).
    runtime: str = "demo-server"


class Fix(_Model):
    finding: FindingCode
    fix: str


class Gap(_Model):
    field: str
    note: str


class Annotation(_Model):
    finding: FindingCode
    before_line: int | None = None
    after_line: int | None = None
    fix: str


class Diff(_Model):
    before: str
    after: str
    annotations: list[Annotation] = Field(default_factory=list)


class BlueprintOutputs(_Model):
    instance_ids: list[str] = Field(default_factory=list)
    tg_target_arn: str | None = None
    tg_legacy_arn: str | None = None
    listener_rule_arn: str | None = None


class BlueprintResult(_Model):
    app_id: str
    blueprint: str = "golden_app@v1"
    inputs: GoldenInputs
    fixes: list[Fix] = Field(default_factory=list)
    gaps: list[Gap] = Field(default_factory=list)
    diff: Diff
    tf_dir: str
    validate_ok: bool = False
    applied: bool = False
    outputs: BlueprintOutputs | None = None
    status: AppStatus


# ---------------------------------------------------------------- Cutover


class GateSample(_Model):
    weight: int
    ts: datetime
    error_rate: float
    p95_ms: float
    target_share: float
    gate: Gate


class Rollback(_Model):
    at_weight: int
    reason: str


class CutoverRun(_Model):
    run_id: str
    app_id: str
    steps: list[int] = Field(default_factory=lambda: [10, 50, 100])
    history: list[GateSample] = Field(default_factory=list)
    result: CutoverResult | None = None
    rollback: Rollback | None = None
    explanation: str | None = None


# ---------------------------------------------------------------- Events + traffic


class Event(_Model):
    id: int
    ts: datetime
    agent: str
    app_id: str | None = None
    type: EventType
    level: EventLevel = "info"
    payload: dict = Field(default_factory=dict)


class TrafficSample(_Model):
    ts: datetime
    app_id: str
    status: int
    latency_ms: float
    served_by: ServedBy
    run_id: str | None = None
