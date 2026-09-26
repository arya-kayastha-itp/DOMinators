import type { AppRecord, Edge, EdgeSignal, FindingCode, Tier, Tiering } from '@/lib/contracts'

// ---------------------------------------------------------------------------
// Mock fleet — mirrors what Discovery produces (docs/TRACK_2_AGENTS_INTELLIGENCE.md).
// The 3 real apps are hand-written from the live Account A; the synthetic fleet is
// seeded so every rehearsal shows the same numbers. Replace with GET /apps, /tiers,
// /edges once the orchestrator is live (see lib/data/source.ts).
// ---------------------------------------------------------------------------

export const LEGACY_VPC = 'vpc-0bc12dd6664275ce7'
export const LEGACY_AMI = 'ami-0b60ca38391b1a1ee'
export const REAL_APP_IDS = ['app-catalog', 'app-pricing', 'app-orders'] as const

const baseline: FindingCode[] = ['NO_VPC_SEGMENTATION', 'PUBLIC_IP', 'SG_OPEN_SSH', 'SG_OPEN_APP', 'EBS_UNENCRYPTED', 'IMDSV1', 'OLD_AMI']

function legacyApp(p: {
  app_id: string; name: string; owner: string; bu: string; ip: string
  env: Record<string, string>; depends_on: string[]; tags: Record<string, string>; extra: FindingCode[]; consumerSg?: string
}): AppRecord {
  return {
    app_id: p.app_id,
    source: 'real',
    name: p.name,
    owner: p.owner,
    business_unit: p.bu,
    runtime: { type: 'ec2', instance_ids: [`${p.app_id} (legacy)`], ami_id: LEGACY_AMI, ami_age_days: 1310, instance_type: 't3.micro', port: 8080, stateful: false },
    network: {
      vpc_id: LEGACY_VPC,
      vpc_has_private_subnet: false,
      subnet_public: true,
      public_ip: true,
      private_ip: p.ip,
      sg_ingress: [
        { port: 22, cidr: '0.0.0.0/0' },
        { port: 8080, cidr: '0.0.0.0/0' },
        { port: 8080, cidr: '10.20.0.0/16' },
        ...(p.consumerSg ? [{ port: 8080, source_sg: p.consumerSg }] : []),
      ],
    },
    storage: { ebs_encrypted: false, volume_gb: 8 },
    metadata: { imds_v2_required: false },
    config: { env: p.env },
    depends_on: p.depends_on,
    tags: { Name: p.app_id, ...p.tags },
    findings: [...baseline, ...p.extra],
    status: 'TIERED',
    license: 'none',
  }
}

export const realApps: AppRecord[] = [
  legacyApp({
    app_id: 'app-catalog', name: 'Catalog API', owner: 'team-x', bu: 'Retail', ip: '10.10.1.61',
    env: {}, depends_on: [], tags: { owner: 'team-x', 'cost-center': 'cc-1', 'data-class': 'internal' }, extra: [], consumerSg: 'app-pricing-sg',
  }),
  legacyApp({
    app_id: 'app-pricing', name: 'Pricing API', owner: 'unknown', bu: 'Retail', ip: '10.10.1.138',
    env: { CATALOG_URL: 'http://10.10.1.61:8080' }, depends_on: ['app-catalog'], tags: { 'depends-on': 'app-catalog' },
    extra: ['MISSING_TAGS', 'HARDCODED_IP'], consumerSg: 'app-orders-sg',
  }),
  legacyApp({
    app_id: 'app-orders', name: 'Orders API', owner: 'unknown', bu: 'Retail', ip: '10.10.1.30',
    env: { PRICING_URL: 'http://10.10.1.138:8080' }, depends_on: ['app-pricing'], tags: { 'depends-on': 'app-pricing' },
    extra: ['MISSING_TAGS', 'HARDCODED_IP'],
  }),
]

// --- seeded PRNG (mulberry32) so the synthetic fleet is stable across reloads ---
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TEAMS = ['team-commerce', 'team-payments', 'team-identity', 'team-search', 'team-data', 'team-platform', 'team-growth', 'team-claims', 'team-member', 'team-pharmacy', 'team-provider', 'team-billing', 'team-risk', 'team-mobile', 'team-web', 'team-analytics', 'team-care', 'team-benefits', 'team-sre', 'team-security', 'team-fulfilment', 'team-catalog', 'team-hr', 'team-finance', 'team-legal']
const BUS = ['Commercial', 'Medicare', 'Medicaid', 'Pharmacy', 'Retail', 'Corporate']
const A = ['Ledger', 'Vector', 'Beacon', 'Relay', 'Prism', 'Harbor', 'Summit', 'Atlas', 'Nimbus', 'Cedar', 'Quartz', 'Signal', 'Orbit', 'Forge', 'Lumen', 'Tidal', 'Sable', 'Juniper', 'Kestrel', 'Meridian']
const B = ['Service', 'Gateway', 'Broker', 'Adapter', 'Sync', 'Bridge', 'Engine', 'Pipeline', 'Store', 'Registry', 'Portal', 'Worker', 'Scheduler', 'Indexer', 'API']
const SIGNALS: EdgeSignal[][] = [['tag'], ['ssm'], ['sg_ref'], ['tag', 'sg_ref'], ['ssm', 'env'], ['tag', 'ssm', 'sg_ref']]

function generateSynthetic(count: number): AppRecord[] {
  const rng = mulberry32(42)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]
  const out: AppRecord[] = []
  // Preferential-attachment degree weights -> a few hub services, most apps 0-3 deps (scale-free).
  const degree: number[] = []
  for (let i = 0; i < count; i++) {
    const id = `syn-${String(i + 1).padStart(5, '0')}`
    const typeRoll = rng()
    const runtimeType = typeRoll < 0.72 ? 'ec2' : typeRoll < 0.93 ? 'ecs' : 'unknown'
    const stateful = rng() < 0.1
    const age = 30 + Math.floor(rng() * 1370)
    const licRoll = rng()
    const license = licRoll < 0.9 ? 'none' : licRoll < 0.96 ? 'commercial' : 'byol'
    const findings: FindingCode[] = []
    const has = (p: number) => rng() < p
    const noSeg = has(0.55)
    if (noSeg) findings.push('NO_VPC_SEGMENTATION')
    if (noSeg || has(0.2)) findings.push('PUBLIC_IP')
    if (has(0.45)) findings.push('SG_OPEN_SSH')
    if (has(0.4)) findings.push('SG_OPEN_APP')
    if (has(0.6)) findings.push('EBS_UNENCRYPTED')
    if (has(0.65)) findings.push('IMDSV1')
    if (age > 365) findings.push('OLD_AMI')
    if (has(0.5)) findings.push('MISSING_TAGS')
    const hardcoded = has(0.3)
    if (hardcoded) findings.push('HARDCODED_IP')
    if (stateful) findings.push('STATEFUL')

    const deps: string[] = []
    if (i > 3 && rng() > 0.18) {
      const m = rng() < 0.6 ? 1 : 2
      for (let k = 0; k < m; k++) {
        // weight earlier nodes by (degree + 1)
        const total = degree.reduce((s, d) => s + d + 1, 0)
        let r = rng() * total
        let j = 0
        for (; j < degree.length; j++) { r -= degree[j] + 1; if (r <= 0) break }
        const target = out[Math.min(j, out.length - 1)].app_id
        if (!deps.includes(target)) { deps.push(target); degree[Math.min(j, out.length - 1)]++ }
      }
    }
    degree.push(0)
    const tags: Record<string, string> = findings.includes('MISSING_TAGS') ? {} : { owner: pick(TEAMS), 'cost-center': `cc-${100 + Math.floor(rng() * 80)}`, 'data-class': pick(['internal', 'confidential', 'public']) }
    out.push({
      app_id: id,
      source: 'synthetic',
      name: `${pick(A)} ${pick(B)}`,
      owner: tags.owner ?? pick(TEAMS),
      business_unit: pick(BUS),
      runtime: { type: runtimeType, instance_ids: [], ami_id: 'ami-synthetic', ami_age_days: age, instance_type: pick(['t3.micro', 't3.small', 'm5.large']), port: pick([8080, 8080, 8080, 3000, 9000]), stateful },
      network: { vpc_id: 'vpc-synthetic', vpc_has_private_subnet: !noSeg, subnet_public: findings.includes('PUBLIC_IP'), public_ip: findings.includes('PUBLIC_IP'), private_ip: `10.${10 + (i % 40)}.${Math.floor(i / 250)}.${i % 250}`, sg_ingress: [] },
      storage: { ebs_encrypted: !findings.includes('EBS_UNENCRYPTED'), volume_gb: stateful ? 200 : 8 },
      metadata: { imds_v2_required: !findings.includes('IMDSV1') },
      config: { env: hardcoded ? { UPSTREAM: `http://10.${20 + (i % 30)}.1.${i % 200}:8080` } : {} },
      depends_on: deps,
      tags,
      findings,
      status: 'TIERED',
      license,
    })
  }
  return out
}

export const syntheticApps: AppRecord[] = generateSynthetic(1000)
export const allApps: AppRecord[] = [...realApps, ...syntheticApps]
export const appById = new Map(allApps.map(a => [a.app_id, a]))

// --- Tiering rules (Track 2, T2-D-5, with decisions D1/D2) ---
export function tierApp(app: AppRecord, depCount: number): Tiering {
  let score = 100
  const reasons: string[] = []
  if (app.runtime.stateful) { score -= 60; reasons.push('stateful workload (−60)') }
  if (app.runtime.type === 'unknown') { score -= 40; reasons.push('unknown runtime (−40)') }
  if (depCount > 5) { score -= 15; reasons.push(`${depCount} dependencies (−15)`) }
  if (app.findings.includes('HARDCODED_IP')) { score -= 10; reasons.push('hardcoded IP in config (−10)') }
  const commercial = app.license === 'commercial'
  const nonEc2 = app.runtime.type !== 'ec2'
  let tier: Tier
  if (score < 40 || app.runtime.stateful || commercial) tier = 'RED'
  else if (score < 75 || nonEc2) tier = 'GRAY'
  else tier = 'GOLDEN'
  if (commercial) reasons.push('commercial license, no BYOL')
  if (nonEc2 && tier === 'GRAY') reasons.push(`${app.runtime.type} runtime needs a human decision`)
  if (tier === 'GOLDEN') reasons.push('stateless', 'matches golden_app pattern', 'all findings auto-fixable')
  const exposed = app.findings.includes('SG_OPEN_SSH') ? 'SSH open to the internet' : app.findings.includes('PUBLIC_IP') ? 'publicly addressable' : 'internally exposed'
  const risk_summary = tier === 'RED'
    ? `Parked for engineering: ${app.runtime.stateful ? 'stateful data needs a replication plan' : commercial ? 'license must be resolved' : 'too many unknowns'}.`
    : tier === 'GRAY'
      ? `Migratable with one human approval; ${exposed}.`
      : `${exposed[0].toUpperCase()}${exposed.slice(1)}; every fix is standard and automatable.`
  // Borderline scores (±5 of a threshold) are the ones sent to Claude via submit_tiering.
  // Ambiguous configs also go to Claude: an ECS task with hardcoded endpoints may or may not
  // map onto golden_app — that judgement call is exactly what the LLM step is for.
  const borderline = Math.abs(score - 75) <= 5 || Math.abs(score - 40) <= 5
  const ambiguous = app.runtime.type === 'ecs' && app.findings.includes('HARDCODED_IP')
  const llm = app.source === 'synthetic' && !app.runtime.stateful && !commercial && (borderline || ambiguous)
  if (llm) reasons.push('ambiguous mapping — tier decided by Claude (submit_tiering)')
  return { app_id: app.app_id, tier, score, reasons, risk_summary, decided_by: llm ? 'llm' : 'rules' }
}

// --- Edges (consumer -> provider) ---
export const edges: Edge[] = allApps.flatMap((a, i) =>
  a.depends_on.map(to => ({
    from: a.app_id,
    to,
    signals: a.source === 'real' ? (['tag', 'ssm', 'sg_ref'] as EdgeSignal[]) : SIGNALS[(i + to.length) % SIGNALS.length],
    source: a.source,
  })),
)

const depCount = new Map<string, number>()
for (const e of edges) depCount.set(e.from, (depCount.get(e.from) ?? 0) + 1)
export const tiers: Tiering[] = allApps.map(a => tierApp(a, depCount.get(a.app_id) ?? 0))
export const tierById = new Map(tiers.map(t => [t.app_id, t]))

// View model the UI renders: AppRecord joined with its Tiering.
export type FleetApp = AppRecord & { tier: Tier; score: number; tiering: Tiering }
export const fleet: FleetApp[] = allApps.map(a => {
  const t = tierById.get(a.app_id)!
  return { ...a, tier: t.tier, score: t.score, tiering: t }
})
export const fleetById = new Map(fleet.map(a => [a.app_id, a]))

export const EDGE_SIGNAL_LABEL: Record<EdgeSignal, string> = {
  tag: 'depends-on tag',
  ssm: 'SSM parameter holds provider IP',
  env: 'env value references provider',
  sg_ref: 'security-group reference',
  flow_log: 'VPC flow logs',
  synthetic: 'synthetic',
}

export const FINDING_META: Record<FindingCode, { label: string; fix: string; severity: 'critical' | 'high' | 'medium' }> = {
  NO_VPC_SEGMENTATION: { label: 'No VPC segmentation', fix: "Placed in the target VPC's private-subnet tier (no IGW route)", severity: 'critical' },
  PUBLIC_IP: { label: 'Public IP', fix: 'Private subnet, no public IP', severity: 'high' },
  SG_OPEN_SSH: { label: 'SSH open to world', fix: 'Port 22 removed; SSM Session Manager', severity: 'critical' },
  SG_OPEN_APP: { label: 'App port open to world', fix: 'Ingress from the edge ALB security group only', severity: 'high' },
  EBS_UNENCRYPTED: { label: 'Unencrypted EBS', fix: 'KMS-encrypted gp3 (alias/mig-ebs)', severity: 'high' },
  IMDSV1: { label: 'IMDSv1 allowed', fix: 'http_tokens = "required" (IMDSv2)', severity: 'medium' },
  OLD_AMI: { label: 'Outdated AMI', fix: 'Latest AL2023 via SSM parameter', severity: 'medium' },
  MISSING_TAGS: { label: 'Missing tags', fix: 'owner / cost-center / data-class enforced, gaps flagged', severity: 'medium' },
  HARDCODED_IP: { label: 'Hardcoded IP', fix: 'UPSTREAM_URL rewritten to the ALB path', severity: 'medium' },
  STATEFUL: { label: 'Stateful', fix: 'Needs native replication (DMS / snapshots) — parked', severity: 'critical' },
}
