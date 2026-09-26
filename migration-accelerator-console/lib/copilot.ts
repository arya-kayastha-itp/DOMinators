import type { ConsoleEvent, FindingCode, Tier, WavePlan } from '@/lib/contracts'
import { FINDING_CODES } from '@/lib/contracts'
import { EDGE_SIGNAL_LABEL, FINDING_META, edges, fleet, fleetById } from '@/lib/data/fleet'
import { buildPlan } from '@/lib/data/planner'
import type { CutoverState } from '@/components/console/console-provider'

// Copilot answers are computed from live console state (rules), never invented.
// With Bedrock connected, Claude only rephrases the computed answer — the numbers
// and citations below stay the source of truth (same governance rule as Cutover).

export type CopilotAnswer = {
  title: string
  text: string
  bullets?: string[]
  citations?: string[]
  actions?: { label: string; href: string }[]
}

type Ctx = { plan: WavePlan; cutovers: Record<string, CutoverState>; events: ConsoleEvent[] }

const pct = (n: number, d: number) => `${Math.round((n / Math.max(d, 1)) * 100)}%`

export const SUGGESTED_PROMPTS = [
  'Why did app-orders roll back?',
  'Which apps have SSH open to the internet?',
  'When do we finish at capacity 12?',
  'Show red apps in Pharmacy',
  'What does app-orders depend on?',
  'Summarize fleet risk',
]

export function answer(q: string, ctx: Ctx): CopilotAnswer {
  const s = q.toLowerCase().trim()
  const appMatch = s.match(/\b(app-[a-z]+|syn-\d{5})\b/)
  const app = appMatch ? fleetById.get(appMatch[1]) : undefined

  // --- rollback explanation ---
  if (/roll|revert|fail|broke/.test(s)) {
    const id = app?.app_id ?? 'app-orders'
    const c = ctx.cutovers[id]
    if (c?.run.rollback) {
      return {
        title: `Why ${id} rolled back`,
        text: c.run.explanation || `Gate failed at ${c.run.rollback.at_weight}%: ${c.run.rollback.reason}.`,
        bullets: [
          `Decision: deterministic gate (${c.run.rollback.reason}) — not the LLM`,
          `Weights restored to legacy 100 / target 0 in ${((c.restoreMs ?? 800) / 1000).toFixed(1)} s`,
          'Target instance kept for debugging; no human input was needed',
        ],
        citations: [`${c.run.run_id} · GATE_FAIL`, `${c.run.run_id} · ROLLED_BACK`],
        actions: [{ label: 'Open cutover', href: '/cutover' }, { label: 'Fix blueprint', href: `/blueprint?app=${id}` }],
      }
    }
    return {
      title: 'No rollback yet',
      text: `${id} hasn't been rolled back in this session. Turn on the bad-wave toggle and run Wave 1 to see the gate catch a broken release — the target will return 500s because UPSTREAM_URL is dropped from its inputs.`,
      actions: [{ label: 'Go to cutover', href: '/cutover' }],
    }
  }

  // --- projection / capacity ---
  if (/finish|when|capacity|timeline|2027|projection|done by/.test(s)) {
    const cap = Number(s.match(/capacity\s*(\d+)/)?.[1] ?? s.match(/(\d+)\s*(apps|per wave)/)?.[1] ?? ctx.plan.capacity_per_wave)
    const p = cap === ctx.plan.capacity_per_wave ? ctx.plan : buildPlan(Math.min(Math.max(cap, 2), 80))
    const pr = p.projection
    return {
      title: `Projection at ${p.capacity_per_wave} apps / wave`,
      text: `${pr.apps_schedulable.toLocaleString()} schedulable apps across ${p.waves.length} waves finish on ${pr.projected_finish} — ${pr.meets_target_2027 ? 'inside' : 'after'} the end-of-2027 target, at ${pr.apps_per_day} apps per working day.`,
      bullets: [
        `${p.parked.length} Red apps parked for engineering (stateful / licensing)`,
        'Wave 0 is the 3 live apps; Gray apps count as 2 slots (human review)',
        'Freeze window 15 Dec – 5 Jan is skipped automatically',
      ],
      citations: [`planner · ${p.plan_id}`],
      actions: [{ label: 'Open plan', href: '/plan' }],
    }
  }

  // --- dependencies ---
  if (/depend|upstream|downstream|calls|graph/.test(s) && app) {
    const out = edges.filter(e => e.from === app.app_id)
    const inc = edges.filter(e => e.to === app.app_id)
    return {
      title: `${app.app_id} dependencies`,
      text: `${app.app_id} calls ${out.length ? out.map(e => e.to).join(', ') : 'nothing upstream'}${inc.length ? ` and is called by ${inc.length} app${inc.length > 1 ? 's' : ''}` : ''}.`,
      bullets: out.map(e => `${e.to} — found via ${e.signals.map(x => EDGE_SIGNAL_LABEL[x]).join(', ')}`),
      citations: ['Discovery · dependency edges'],
      actions: [{ label: 'Open graph', href: '/dependencies' }],
    }
  }

  // --- single app ---
  if (app) {
    return {
      title: `${app.app_id} · ${app.name}`,
      text: `${app.tier} tier (score ${app.score}, decided by ${app.tiering.decided_by}). ${app.tiering.risk_summary}`,
      bullets: app.findings.map(f => `${f} → ${FINDING_META[f].fix}`),
      citations: [`Discovery · ${app.app_id}`],
      actions: [{ label: 'View in fleet', href: `/fleet?q=${app.app_id}` }, ...(app.source === 'real' ? [{ label: 'Blueprint', href: `/blueprint?app=${app.app_id}` }] : [])],
    }
  }

  // --- finding filters ---
  const findingKeywords: [RegExp, FindingCode][] = [[/ssh|port 22/, 'SG_OPEN_SSH'], [/segment|private subnet|vpc/, 'NO_VPC_SEGMENTATION'], [/encrypt|ebs/, 'EBS_UNENCRYPTED'], [/imds|metadata/, 'IMDSV1'], [/ami|image|outdated/, 'OLD_AMI'], [/tag/, 'MISSING_TAGS'], [/hardcod|ip literal/, 'HARDCODED_IP'], [/public ip/, 'PUBLIC_IP'], [/stateful|database/, 'STATEFUL'], [/app port|8080/, 'SG_OPEN_APP']]
  const finding = findingKeywords.find(([re]) => re.test(s))?.[1] ?? FINDING_CODES.find(c => s.includes(c.toLowerCase()))
  if (finding) {
    const hits = fleet.filter(a => a.findings.includes(finding))
    const real = hits.filter(a => a.source === 'real')
    return {
      title: `${FINDING_META[finding].label} · ${hits.length.toLocaleString()} apps`,
      text: `${hits.length.toLocaleString()} of ${fleet.length.toLocaleString()} apps (${pct(hits.length, fleet.length)}) have ${finding}${real.length ? `, including ${real.map(a => a.app_id).join(', ')}` : ''}. The golden module fixes it by default: ${FINDING_META[finding].fix}.`,
      bullets: hits.slice(0, 5).map(a => `${a.app_id} · ${a.name} · ${a.tier}`),
      citations: ['Discovery · finding rules'],
      actions: [{ label: 'Filter fleet', href: `/fleet?finding=${finding}` }],
    }
  }

  // --- tier / business-unit filters ---
  const tier = (['golden', 'gray', 'grey', 'red'] as const).find(t => s.includes(t))
  const bu = ['commercial', 'medicare', 'medicaid', 'pharmacy', 'retail', 'corporate'].find(b => s.includes(b))
  if (tier || bu) {
    const T = tier ? ((tier === 'grey' ? 'GRAY' : tier.toUpperCase()) as Tier) : undefined
    const hits = fleet.filter(a => (!T || a.tier === T) && (!bu || a.business_unit.toLowerCase() === bu))
    return {
      title: `${T ?? 'All'} apps${bu ? ` in ${bu[0].toUpperCase()}${bu.slice(1)}` : ''} · ${hits.length}`,
      text: `${hits.length} matching apps. ${T === 'RED' ? 'Red apps are parked for engineering — stateful data or commercial licensing blocks automation.' : T === 'GRAY' ? 'Gray apps migrate after one human approval of the generated diff.' : T === 'GOLDEN' ? 'Golden apps flow through the pipeline untouched.' : ''}`,
      bullets: hits.slice(0, 6).map(a => `${a.app_id} · ${a.name} · ${a.tiering.reasons[0]}`),
      citations: ['Discovery · tiering'],
      actions: [{ label: 'Open fleet', href: `/fleet?${T ? `tier=${T}` : ''}${bu ? `&bu=${bu}` : ''}` }],
    }
  }

  // --- overall summary (default) ---
  const counts = { GOLDEN: 0, GRAY: 0, RED: 0 } as Record<Tier, number>
  for (const a of fleet) counts[a.tier]++
  const top = [...FINDING_CODES].map(c => [c, fleet.filter(a => a.findings.includes(c)).length] as const).sort((a, b) => b[1] - a[1]).slice(0, 3)
  return {
    title: 'Fleet risk summary',
    text: `${fleet.length.toLocaleString()} apps discovered: ${pct(counts.GOLDEN, fleet.length)} Golden, ${pct(counts.GRAY, fleet.length)} Gray, ${pct(counts.RED, fleet.length)} Red. At the current plan we finish ${ctx.plan.projection.projected_finish}${ctx.plan.projection.meets_target_2027 ? ', inside the 2027 target' : ''}.`,
    bullets: top.map(([c, n]) => `${c}: ${n} apps — ${FINDING_META[c].fix}`),
    citations: ['Discovery · summary', `planner · ${ctx.plan.plan_id}`],
    actions: [{ label: 'Open overview', href: '/' }],
  }
}
