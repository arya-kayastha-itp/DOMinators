import { CloudCheck, Database, Layers3, Radar, Rocket, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { DemoState, Summary } from '@/lib/api'

// ---------------------------------------------------------------------------
// THE PIPELINE — edit this array to change every section of /journey.
//
// Order matters: the SVG path, the packet, the live-run section and the final
// CTA all follow it. PIPELINE holds the static story; liveStages() overlays
// the numbers the orchestrator reports (GET /summary, GET /demo/state) when it
// is reachable. REFERENCE is what the page shows when it is not — the real
// fleet and the recorded end-to-end run, never an invented figure.
// ---------------------------------------------------------------------------

export type StageStatus = 'queued' | 'running' | 'passed' | 'failed'

export interface PipelineStage {
  id: string
  name: string
  /** Who runs it / where it happens — shown above the name. */
  kicker: string
  description: string
  icon: LucideIcon
  input: string[]
  output: string[]
  /** One headline number for the node card. */
  metric: { value: string; label: string }
  /** Extra facts for the full-screen deep dive. */
  details: string[]
}

/** Ground truth used when the orchestrator is offline. */
export const REFERENCE = {
  appsTotal: 1006,
  real: 6,
  synthetic: 1000,
  findingCodes: 10,
  golden: ['app-catalog', 'app-pricing', 'app-orders', 'app-juice-shop'],
  stateful: ['app-gitea', 'app-vaultwarden'],
  wave0: ['app-catalog', 'app-pricing', 'app-orders', 'app-juice-shop'],
  capacityPerWave: 40,
  wavesPerWeek: 3,
  steps: [10, 50, 100],
  observeS: 35,
  settleS: 15,
  gates: { maxErrorRate: 0.02, maxP95Ms: 800, minTargetShareRatio: 0.6 },
  /** The recorded end-to-end run (app-catalog, later restored to legacy). */
  run: {
    app: 'app-catalog',
    targetShare: [0.097, 0.5, 1.0],
    errorRate: 0,
    p95: '~100–120 ms',
    duration: '~110 s',
  },
} as const

const short = (id: string) => id.replace(/^app-/, '')
const pct = (x: number) => `${Math.round(x * 100)}%`

export const PIPELINE: PipelineStage[] = [
  {
    id: 'legacy',
    name: 'Legacy estate',
    kicker: 'Source · Account A',
    description:
      'Six deliberately insecure EC2 apps in a flat VPC with no private tier, plus 1,000 synthetic app records (fleet.json, seed 42) standing in for the rest of the estate.',
    icon: Database,
    input: ['Account A · 10.10.0.0/16', 'fleet.json (seed 42)'],
    output: ['Read-only discovery role', 'Raw instance + SSM config'],
    metric: { value: '10', label: 'finding codes planted' },
    details: [
      'Golden candidates: app-catalog, app-pricing, app-orders and app-juice-shop.',
      'app-gitea and app-vaultwarden are stateful: they are tiered Red, parked and never migrated.',
      'Headline finding: NO_VPC_SEGMENTATION — every route table sends 0.0.0.0/0 to the IGW.',
      'Dependencies hidden three ways: depends-on tags, /legacy/* SSM params, SG-to-SG rules.',
      'Synthetic apps carry raw config only; findings are computed by Discovery, never pre-labelled.',
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
    metric: { value: '1,006', label: 'apps discovered + tiered' },
    details: [
      'Two-hop AssumeRole: mig-agent-runner → mig-discovery-readonly. Read-only by trust policy.',
      'Rules tier the clear cases; the LLM only breaks ties on borderline ones and explains them.',
      'Real and synthetic apps go through the exact same normalisation and finding rules.',
      'Emits DISCOVERY_DONE with counts by tier.',
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
    output: ['WavePlan', 'Projection vs the end-2027 target'],
    metric: { value: 'Wave 0', label: 'catalog → pricing → orders → juice-shop' },
    details: [
      'Red apps move to PARKED and go to an engineering queue.',
      'Strongly connected components migrate together; no consumer ever moves before its provider.',
      'Wave 0 is the four real golden apps in dependency order, so the pilot can run immediately.',
      'The projected finish is computed by the planner from capacity per wave and waves per week (default 40 apps/wave, 3 waves/week).',
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
    metric: { value: 'golden_app', label: 'one hardened Terraform module for every app' },
    details: [
      'Rules map the module variables (port and env are pinned); inputs are schema-validated and raw HCL is never hand-written.',
      'Private subnet, KMS-encrypted gp3, IMDSv2 required, SSM instead of SSH, ALB-only ingress.',
      'terraform validate + plan runs before every apply.',
      'Synthetic apps get a dry-run diff only; no infrastructure is created.',
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
    metric: { value: '< 2 s', label: 'automatic rollback' },
    details: [
      'Gates: all targets healthy, error rate ≤ 2%, p95 ≤ 800 ms, ≥ 60% of the expected share served by target.',
      'Each step observes a 35 s window after a 15 s settle.',
      'Rollback is plain code, so it is deterministic: weights go back to 100/0 automatically. The LLM only writes the explanation afterwards.',
      'Weights are restored in a finally block and on signals, so even a hard kill leaves 100/0.',
      'Bad-wave demo: a blueprint ships without UPSTREAM_URL, the first gate catches it and the cutover rolls back by itself.',
    ],
  },
  {
    id: 'live',
    name: 'Landing zone live',
    kicker: 'Target · Account B',
    description:
      'Migrated apps answer from the hardened target environment behind the same edge ALB, and every agent decision is in the audit trail.',
    icon: CloudCheck,
    input: ['CutoverRun', 'Event stream'],
    output: ['served_by: target', 'Audit trail over SSE'],
    metric: { value: '1', label: 'real app cut over end to end (app-catalog)' },
    details: [
      'Account B · 10.20.0.0/16 with real public/private tiering and NAT.',
      'Every tool call, prompt and result is logged as an event: that log is the audit trail.',
      'Mutating tools only touch resources tagged managed-by=migration-accelerator.',
      'app-hello is a live demo app in Account B on the same golden pattern.',
    ],
  },
]

/** Which stages have actually happened on the live system, in PIPELINE order. */
export function stagesReached(summary: Summary | null): boolean[] {
  if (!summary) return PIPELINE.map(() => false)
  const real = summary.real_apps ?? []
  const cutovers = Object.values(summary.cutovers_real ?? {})
  const provisioned = real.some((a) => ['PROVISIONED', 'CUTTING_OVER', 'MIGRATED', 'ROLLED_BACK'].includes(a.status)) || cutovers.length > 0
  const migrated = cutovers.some((c) => c.result === 'MIGRATED') || real.some((a) => a.status === 'MIGRATED')
  const reached: Record<string, boolean> = {
    legacy: summary.real > 0,
    discovery: summary.discovered,
    planning: summary.plan !== null,
    blueprint: provisioned,
    cutover: migrated,
    live: migrated,
  }
  return PIPELINE.map((s) => reached[s.id] ?? false)
}

/** PIPELINE with the orchestrator's live numbers laid over it. */
export function liveStages(summary: Summary | null, demo: DemoState | null): PipelineStage[] {
  if (!summary && !demo) return PIPELINE
  return PIPELINE.map((stage) => {
    const s = { ...stage, metric: { ...stage.metric }, details: [...stage.details] }

    if (summary?.discovered) {
      if (s.id === 'legacy') {
        s.metric = { value: String(summary.finding_codes_seen), label: 'finding codes detected across the fleet' }
        s.description = `${summary.real} deliberately insecure EC2 apps in a flat VPC with no private tier, plus ${summary.synthetic.toLocaleString('en-US')} synthetic app records (fleet.json, seed 42) standing in for the rest of the estate.`
        s.details.push(`Live: ${summary.real} real apps with ${summary.findings_real_total} findings and ${summary.edges_real} real dependency edges.`)
      }
      if (s.id === 'discovery') {
        s.metric = { value: summary.apps_total.toLocaleString('en-US'), label: 'apps discovered + tiered' }
        const t = summary.tiers
        const ld = summary.last_discovery
        s.details.push(
          `Live: golden ${t.GOLDEN} · gray ${t.GRAY} · red ${t.RED}` +
            (ld ? ` · last run ${(ld.duration_ms / 1000).toFixed(1)} s` : '') +
            (summary.llm_decisions ? ` · ${summary.llm_decisions} tie-breaks by the LLM` : ''),
        )
      }
    }

    if (s.id === 'planning' && summary?.plan) {
      const p = summary.plan
      if (p.wave0.length) s.metric = { value: 'Wave 0', label: p.wave0.map(short).join(' → ') }
      const fin = p.projection?.projected_finish
      if (fin) {
        s.details[3] =
          `Live plan: ${p.waves} waves at ${p.capacity_per_wave} apps/wave, ${p.waves_per_week} waves/week, ${p.parked} parked · ` +
          `projected finish ${fmtMonth(fin)}` +
          (p.projection.meets_target_2027 ? ' (meets the 2027 target).' : ' (misses the 2027 target).')
      }
    }

    if (s.id === 'cutover' && demo?.cutover_config) {
      const c = demo.cutover_config
      const g = c.gates
      s.description = `Shifts ALB weights ${c.steps.join(' → ')}% under live traffic, checks the gates at every step and snaps back to legacy the moment one fails.`
      s.details[0] =
        `Gates: ${g.require_healthy_targets ? 'all targets healthy, ' : ''}error rate ≤ ${pct(g.max_error_rate)}, p95 ≤ ${g.max_p95_ms} ms, ` +
        `≥ ${pct(g.min_target_share_ratio)} of the expected share served by target.`
      s.details[1] = `Each step observes a ${c.observe_window_s} s window after a ${c.settle_s} s settle.`
    }

    if (s.id === 'live' && summary) {
      const done = Object.values(summary.cutovers_real ?? {}).filter((c) => c.result === 'MIGRATED').map((c) => c.app_id)
      s.metric = done.length
        ? { value: String(done.length), label: `real app${done.length === 1 ? '' : 's'} cut over end to end (${done.join(', ')})` }
        : { value: '0', label: 'real cutovers on record — start one from the console' }
    }

    return s
  })
}

export function fmtMonth(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
