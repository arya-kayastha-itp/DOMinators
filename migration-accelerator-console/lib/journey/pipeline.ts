import { CloudCheck, Database, Layers3, Radar, Rocket, ShieldCheck, type LucideIcon } from 'lucide-react'

// ---------------------------------------------------------------------------
// THE PIPELINE — edit this array to change every section of /journey.
//
// Order matters: the SVG path, the packet, the live-status run and the final
// CTA all follow it. Content is taken from docs/FLOW.md, docs/ARCHITECTURE.md
// and the live values recorded in checklist.md.
//
// `status` is the state the live-status run ends on. `logs` are replayed in
// order; a line with level 'error' flips the stage to `failed` until the next
// line arrives (that is how the bad-wave rollback + retry is told).
// ---------------------------------------------------------------------------

export type StageStatus = 'queued' | 'running' | 'passed' | 'failed'

export interface LogLine {
  text: string
  level?: 'info' | 'ok' | 'warn' | 'error'
}

export interface PipelineStage {
  id: string
  name: string
  /** Who runs it / where it happens — shown above the name. */
  kicker: string
  description: string
  icon: LucideIcon
  input: string[]
  output: string[]
  status: StageStatus
  /** One headline number for the node card. */
  metric: { value: string; label: string }
  /** Extra facts for the full-screen deep dive. */
  details: string[]
  logs: LogLine[]
}

export const PIPELINE: PipelineStage[] = [
  {
    id: 'legacy',
    name: 'Legacy estate',
    kicker: 'Source · Account A',
    description:
      'Three deliberately insecure EC2 apps in a flat VPC with no private tier, plus ~1,000 synthetic app records standing in for the rest of the estate.',
    icon: Database,
    input: ['Account A · 10.10.0.0/16', 'fleet.json (seed 42)'],
    output: ['Read-only discovery role', 'Raw instance + SSM config'],
    status: 'passed',
    metric: { value: '9', label: 'finding codes planted' },
    details: [
      'app-catalog, app-pricing and app-orders run behind the edge ALB over VPC peering.',
      'Headline finding: NO_VPC_SEGMENTATION — every route table sends 0.0.0.0/0 to the IGW.',
      'Dependencies hidden three ways: depends-on tags, /legacy/* SSM params, SG-to-SG rules.',
      'Synthetic apps carry raw config only; findings are computed by Discovery, never pre-labelled.',
    ],
    logs: [
      { text: 'vpc-0bc12dd6664275ce7 · 10.10.0.0/16 · no private tier' },
      { text: 'app-catalog 10.10.1.61 · app-pricing 10.10.1.138 · app-orders 10.10.1.30' },
      { text: 'peering pcx-0ae4efd1f16fc19be · active' },
      { text: 'GET /orders/ → 200 · served_by: legacy', level: 'ok' },
    ],
  },
  {
    id: 'discovery',
    name: 'Discovery',
    kicker: 'Agent 01 · scan + tier',
    description:
      'Scans Account A through a read-only role, groups instances into apps, detects findings, maps dependencies from three signals and tiers every app Golden, Gray or Red.',
    icon: Radar,
    input: ['EC2 · SG · EBS · AMI describe calls', 'SSM /legacy/* parameters', 'fleet.json'],
    output: ['AppRecord[]', 'Tiering[]', 'Dependency edges'],
    status: 'passed',
    metric: { value: '1,003', label: 'apps discovered + tiered' },
    details: [
      'Two-hop AssumeRole: mig-agent-runner → mig-discovery-readonly. Read-only by trust policy.',
      'Rules tier the clear cases; Claude only settles the borderline ones through submit_tiering.',
      'Real and synthetic apps go through the exact same normalisation and finding rules.',
      'Emits DISCOVERY_DONE with counts by tier.',
    ],
    logs: [
      { text: 'AssumeRole mig-agent-runner → mig-discovery-readonly' },
      { text: 'describe_instances · IncludeDeprecated=True · 3 instances' },
      { text: 'ssm get_parameters_by_path /legacy/' },
      { text: 'edges: orders → pricing → catalog (tag · ssm · sg)' },
      { text: 'fleet.json · 1,000 synthetic records ingested' },
      { text: 'DISCOVERY_DONE · golden 60% · gray 25% · red 15%', level: 'ok' },
    ],
  },
  {
    id: 'planning',
    name: 'Planning',
    kicker: 'Agent 02 · wave schedule',
    description:
      'Parks Red apps, builds the dependency graph, orders providers before consumers and packs Golden-then-Gray clusters into capacity-bounded waves with a projected finish date.',
    icon: Layers3,
    input: ['AppRecord[] + Tiering[]', 'Dependency edges', 'capacity_per_wave'],
    output: ['WavePlan', 'Projection to end-2027'],
    status: 'passed',
    metric: { value: 'Wave 0', label: 'the 3 real apps, piloted first' },
    details: [
      'Red apps move to PARKED and go to an engineering queue.',
      'Strongly connected components migrate together; no consumer ever moves before its provider.',
      'Wave 0 is always the 3 real apps, so the pilot can run immediately.',
      'Plans 1,000 apps in under a second.',
    ],
    logs: [
      { text: 'Red tier → PARKED' },
      { text: 'dependency closure · SCC clusters built' },
      { text: 'topological order: catalog → pricing → orders' },
      { text: 'Wave 0 (pilot) · 3 real apps' },
      { text: 'PLAN_DONE · projected finish Sep 2027', level: 'ok' },
    ],
  },
  {
    id: 'blueprint',
    name: 'Blueprint / IaC',
    kicker: 'Agent 03 · match + generate + apply',
    description:
      'Maps each legacy config onto the hardened golden_app module, renders Terraform, shows the annotated before/after diff and applies it in Account B.',
    icon: ShieldCheck,
    input: ['AppRecord', 'golden_app variable schema', 'target_outputs.json'],
    output: ['generated/<app>/main.tf', 'Annotated diff', 'BlueprintResult'],
    status: 'passed',
    metric: { value: '≥ 7', label: 'annotated fixes per app' },
    details: [
      'Claude fills schema-validated module variables. It never writes raw HCL.',
      'Private subnet, KMS-encrypted gp3, IMDSv2 required, SSM instead of SSH, ALB-only ingress.',
      'terraform validate + plan runs before every apply.',
      'Synthetic apps get a dry-run diff only; no infrastructure is created.',
    ],
    logs: [
      { text: 'set_golden_inputs(app-catalog) · schema ✓' },
      { text: 'render generated/app-catalog/main.tf' },
      { text: 'terraform init · validate ✓ · plan ✓' },
      { text: 'BLUEPRINT_READY · fixes annotated' },
      { text: 'PROVISIONED · tg-app-catalog-target healthy', level: 'ok' },
    ],
  },
  {
    id: 'cutover',
    name: 'Cutover',
    kicker: 'Agent 04 · shift + verify',
    description:
      'Shifts ALB weights 10 → 50 → 100% under live traffic, checks the gates at every step and snaps back to legacy the moment one fails.',
    icon: Rocket,
    input: ['BlueprintResult', 'Target group ARNs', 'Live traffic · ~20 req/s'],
    output: ['CutoverRun', 'MIGRATED or ROLLED_BACK'],
    status: 'passed',
    metric: { value: '< 2 s', label: 'automatic rollback' },
    details: [
      'Gates: all targets healthy, error rate ≤ 2%, p95 ≤ 800 ms, ≥ 80% of the expected share served by target.',
      'Rollback is plain code, so it is deterministic. Claude only writes the explanation afterwards.',
      'Weights are restored in a finally block and on signals, so even a hard kill leaves 100/0.',
      'The bad wave: app-orders ships without UPSTREAM_URL, fails at 10% and rolls back by itself.',
    ],
    logs: [
      { text: 'precheck · tg-app-orders-target healthy' },
      { text: 'WEIGHT_SET 10% · observing 20 s window' },
      { text: 'gate failed · 38% 5xx from target', level: 'error' },
      { text: 'ROLLED_BACK · weights 100/0 in 0.8 s', level: 'warn' },
      { text: 'fix & retry · UPSTREAM_URL restored' },
      { text: 'WEIGHT_SET 10 → 50 → 100% · all gates green' },
      { text: 'MIGRATED · app-orders', level: 'ok' },
    ],
  },
  {
    id: 'live',
    name: 'Landing zone live',
    kicker: 'Target · Account B',
    description:
      'Apps now answer from the hardened target environment behind the same edge ALB, and every agent decision is in the audit trail.',
    icon: CloudCheck,
    input: ['CutoverRun', 'Event stream'],
    output: ['served_by: target', 'Audit trail over SSE'],
    status: 'passed',
    metric: { value: '100%', label: 'traffic on the golden pattern' },
    details: [
      'Account B · 10.20.0.0/16 with real public/private tiering and NAT.',
      'Every tool call, prompt and result is logged as an event: that log is the audit trail.',
      'Mutating tools only touch resources tagged managed-by=migration-accelerator.',
      'The same pattern already serves app-hello in production.',
    ],
    logs: [
      { text: 'GET /orders/ → 200 · served_by: target' },
      { text: 'orders → pricing → catalog · all served by target' },
      { text: 'events → dashboard over SSE', level: 'ok' },
    ],
  },
]
