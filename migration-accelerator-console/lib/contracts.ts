// TypeScript mirror of docs/CONTRACTS.md (incl. the agents-phase addendum).
// Keep these shapes identical to the orchestrator's JSON so the mock layer in
// lib/data can be swapped for the live API without touching any screen.

export type Source = 'real' | 'synthetic'
export type Tier = 'GOLDEN' | 'GRAY' | 'RED'

export const FINDING_CODES = [
  'NO_VPC_SEGMENTATION',
  'PUBLIC_IP',
  'SG_OPEN_SSH',
  'SG_OPEN_APP',
  'EBS_UNENCRYPTED',
  'IMDSV1',
  'OLD_AMI',
  'MISSING_TAGS',
  'HARDCODED_IP',
  'STATEFUL',
] as const
export type FindingCode = (typeof FINDING_CODES)[number]

export type AppStatus =
  | 'DISCOVERED'
  | 'TIERED'
  | 'PLANNED'
  | 'PARKED'
  | 'BLUEPRINTED'
  | 'PROVISIONED'
  | 'FAILED'
  | 'CUTTING_OVER'
  | 'MIGRATED'
  | 'ROLLED_BACK'

export type AppRecord = {
  app_id: string
  source: Source
  name: string
  owner: string
  business_unit: string
  runtime: {
    type: 'ec2' | 'ecs' | 'unknown'
    instance_ids: string[]
    ami_id: string
    ami_age_days: number | null
    instance_type: string
    port: number
    stateful: boolean
  }
  network: {
    vpc_id: string
    vpc_has_private_subnet: boolean
    subnet_public: boolean
    public_ip: boolean
    private_ip: string
    sg_ingress: { port: number; cidr?: string; source_sg?: string }[]
  }
  storage: { ebs_encrypted: boolean; volume_gb: number }
  metadata: { imds_v2_required: boolean }
  config: { env: Record<string, string> }
  depends_on: string[]
  tags: Record<string, string>
  findings: FindingCode[]
  status: AppStatus
  license?: 'none' | 'commercial' | 'byol'
}

export type Tiering = {
  app_id: string
  tier: Tier
  score: number
  reasons: string[]
  risk_summary: string
  decided_by: 'rules' | 'llm'
}

export type EdgeSignal = 'tag' | 'ssm' | 'env' | 'sg_ref' | 'flow_log' | 'synthetic'
export type Edge = { from: string; to: string; signals: EdgeSignal[]; source: Source }

export type Wave = {
  wave: number
  name?: string
  start: string
  app_ids: string[]
  tier_mix: Partial<Record<Tier, number>>
  rationale?: string
}

export type WavePlan = {
  plan_id: string
  generated_at: string
  capacity_per_wave: number
  waves_per_week: number
  waves: Wave[]
  parked: string[]
  projection: {
    apps_total: number
    apps_schedulable: number
    projected_finish: string
    apps_per_day: number
    meets_target_2027: boolean
  }
}

export type DiffAnnotation = { finding: FindingCode; before_line: number | null; after_line: number | null; fix: string }

export type BlueprintResult = {
  app_id: string
  blueprint: string
  inputs: {
    name: string
    port: number
    instance_type: string
    env: Record<string, string>
    tags: Record<string, string>
  }
  fixes: { finding: FindingCode; fix: string }[]
  gaps: { field: string; note: string }[]
  diff: { before: string; after: string; annotations: DiffAnnotation[] }
  tf_dir: string
  validate_ok: boolean
  applied: boolean
  outputs: { instance_ids: string[]; tg_target_arn: string; tg_legacy_arn: string; listener_rule_arn: string }
  status: 'BLUEPRINTED' | 'PROVISIONED' | 'FAILED'
}

export type GateName = 'healthy_targets' | 'error_rate' | 'p95_ms' | 'target_share'

export type CutoverStep = {
  weight: number
  ts: string
  error_rate: number
  p95_ms: number
  target_share: number
  gate: 'PASS' | 'FAIL'
}

export type CutoverRun = {
  run_id: string
  app_id: string
  steps: number[]
  history: CutoverStep[]
  result: 'MIGRATED' | 'ROLLED_BACK' | 'ABORTED' | null
  rollback: { at_weight: number; reason: string } | null
  explanation: string
}

export type EventType =
  | 'DISCOVERY_STARTED' | 'APP_DISCOVERED' | 'DISCOVERY_DONE'
  | 'PLAN_DONE'
  | 'BLUEPRINT_READY' | 'BLUEPRINT_DRY_RUN' | 'PROVISIONED' | 'BLUEPRINT_FAILED'
  | 'CUTOVER_STARTED' | 'WEIGHT_SET' | 'GATE_PASS' | 'GATE_FAIL' | 'ROLLED_BACK' | 'MIGRATED' | 'CUTOVER_ABORTED'
  | 'SIM_DATA_MIGRATION' | 'SIM_DECOMMISSION' | 'SIM_LICENSE_FLAG' | 'SIM_NOTIFY'
  | 'TOOL_CALL' | 'LLM_FALLBACK'
  | 'ERROR'

export type AgentName = 'discovery' | 'planning' | 'blueprint' | 'cutover'

export type ConsoleEvent = {
  id: number
  ts: string
  agent: AgentName | 'orchestrator'
  app_id: string | null
  type: EventType
  level: 'info' | 'success' | 'warn' | 'error'
  payload: Record<string, unknown>
  /** UI-only: one-line human summary rendered in feeds. */
  summary: string
  decided_by?: 'rules' | 'llm'
}

export type TrafficSample = { ts: number; app_id: string; status: number; latency_ms: number; served_by: 'legacy' | 'target' | 'unknown' }
