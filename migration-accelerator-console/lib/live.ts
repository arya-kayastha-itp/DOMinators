// Derive live run state purely from the event stream (no timers, no guesses):
// a cutover's steps, gates and countdown; a blueprint's stage and terraform log.
import type { ConsoleEvent } from '@/lib/contracts'

const ms = (iso: string) => Date.parse(iso)

// ---------------------------------------------------------------- cutover

export type StepState = { weight: number; setAt?: number; gate?: 'PASS' | 'FAIL'; metrics?: { error_rate?: number; p95_ms?: number; target_share?: number }; reasons?: string[] }

export type CutoverLive = {
  phase: 'idle' | 'warmup' | 'observing' | 'rolled_back' | 'migrated' | 'aborted'
  weight: number
  steps: StepState[]
  windowStart: number | null
  startedAt: number | null
  endedAt: number | null
  rollback: { at_weight?: number; reason?: string; ts: number } | null
  abortReason: string | null
  weightTimeline: { t: number; weight: number }[]
}

export function cutoverLive(eventsNewestFirst: ConsoleEvent[], appId: string, stepsCfg: number[] = [10, 50, 100]): CutoverLive {
  const evs = eventsNewestFirst.filter(e => e.app_id === appId && !e.payload?.sim).slice().reverse()
  // A run begins at the orchestrator's traffic-generator notice (warm-up);
  // a run started outside the orchestrator only has CUTOVER_STARTED.
  const isNotice = (e: ConsoleEvent) => e.type === 'SIM_NOTIFY' && String(e.payload?.message ?? '').startsWith('Traffic generator')
  let start = evs.findLastIndex(isNotice)
  const lastStarted = evs.findLastIndex(e => e.type === 'CUTOVER_STARTED')
  if (lastStarted > start && evs.slice(start + 1, lastStarted).some(e => e.type === 'MIGRATED' || e.type === 'ROLLED_BACK')) start = lastStarted
  if (start < 0) start = lastStarted
  const out: CutoverLive = { phase: 'idle', weight: 0, steps: stepsCfg.map(w => ({ weight: w })), windowStart: null, startedAt: null, endedAt: null, rollback: null, abortReason: null, weightTimeline: [] }
  // Manual break-glass weights outside a run still move the split.
  for (const e of evs) if (e.type === 'WEIGHT_SET' && e.payload?.manual) { out.weight = Number(e.payload.weight); out.weightTimeline.push({ t: ms(e.ts), weight: out.weight }) }
  if (start < 0) return out
  const run = evs.slice(start)
  out.phase = 'warmup'
  out.startedAt = ms(run[0].ts)
  out.weight = 0
  out.weightTimeline = [{ t: out.startedAt, weight: 0 }]
  for (const e of run) {
    const p = e.payload ?? {}
    if (e.type === 'CUTOVER_STARTED' && Array.isArray(p.steps)) out.steps = (p.steps as number[]).map(w => ({ weight: w }))
    if (e.type === 'WEIGHT_SET') {
      const w = Number(p.weight)
      out.weight = w
      out.weightTimeline.push({ t: ms(e.ts), weight: w })
      if (!p.manual) {
        out.phase = 'observing'
        out.windowStart = ms(e.ts)
        const s = out.steps.find(x => x.weight === w)
        if (s) s.setAt = ms(e.ts)
      }
    }
    if (e.type === 'GATE_PASS' || e.type === 'GATE_FAIL') {
      const s = out.steps.find(x => x.weight === Number(p.weight))
      if (s) {
        s.gate = e.type === 'GATE_PASS' ? 'PASS' : 'FAIL'
        s.metrics = { error_rate: p.error_rate as number | undefined, p95_ms: p.p95_ms as number | undefined, target_share: p.target_share as number | undefined }
        if (Array.isArray(p.reasons)) s.reasons = p.reasons as string[]
      }
    }
    if (e.type === 'ROLLED_BACK') {
      out.phase = 'rolled_back'; out.weight = 0; out.endedAt = ms(e.ts); out.windowStart = null
      out.rollback = { at_weight: p.at_weight as number | undefined, reason: p.reason as string | undefined, ts: ms(e.ts) }
      out.weightTimeline.push({ t: ms(e.ts), weight: 0 })
    }
    if (e.type === 'MIGRATED') { out.phase = 'migrated'; out.endedAt = ms(e.ts); out.windowStart = null }
    if (e.type === 'CUTOVER_ABORTED') { out.phase = 'aborted'; out.endedAt = ms(e.ts); out.abortReason = String(p.reason ?? '') }
  }
  return out
}

// ---------------------------------------------------------------- blueprint

export const BLUEPRINT_STAGES = ['Map inputs', 'Render + diff', 'terraform init', 'terraform validate', 'terraform plan', 'terraform apply', 'Target healthy'] as const

export type BlueprintLive = {
  started: boolean
  apply: boolean
  stage: number          // index of the furthest stage reached
  done: boolean
  failed: string | null
  log: { id: number; ts: string; tool: string; line: string }[]
  startedAt: number | null
  endedAt: number | null
}

const TOOL_STAGE: Record<string, number> = { 'terraform init': 2, 'terraform validate': 3, 'terraform plan': 4, 'terraform show': 4, 'terraform apply': 5 }

export function blueprintLive(eventsNewestFirst: ConsoleEvent[], appId: string): BlueprintLive {
  const evs = eventsNewestFirst.filter(e => e.app_id === appId).slice().reverse()
  let start = -1
  for (let i = evs.length - 1; i >= 0; i--) if (evs[i].type === 'SIM_NOTIFY' && evs[i].payload?.stage === 'blueprint_start') { start = i; break }
  const out: BlueprintLive = { started: false, apply: false, stage: 0, done: false, failed: null, log: [], startedAt: null, endedAt: null }
  if (start < 0) return out
  out.started = true
  out.apply = Boolean(evs[start].payload?.apply)
  out.startedAt = ms(evs[start].ts)
  for (const e of evs.slice(start + 1)) {
    const p = e.payload ?? {}
    if (e.type === 'TOOL_CALL' && typeof p.tool === 'string' && p.tool.startsWith('terraform')) {
      out.stage = Math.max(out.stage, TOOL_STAGE[p.tool] ?? out.stage, 1)
      // eslint-disable-next-line no-control-regex
      out.log.push({ id: e.id, ts: e.ts, tool: p.tool, line: String(p.line ?? '').replace(/\x1b\[[0-9;]*m/g, '') })
    }
    if (e.type === 'BLUEPRINT_READY') { out.stage = Math.max(out.stage, 3); if (!out.apply) { out.done = true; out.stage = 4; out.endedAt = ms(e.ts) } }
    if (e.type === 'BLUEPRINT_DRY_RUN') { out.done = true; out.stage = Math.max(out.stage, 1); out.endedAt = ms(e.ts) }
    if (e.type === 'PROVISIONED') { out.done = true; out.stage = BLUEPRINT_STAGES.length; out.endedAt = ms(e.ts) }
    if (e.type === 'BLUEPRINT_FAILED') { out.failed = `${p.step ?? 'step'}: ${String(p.error ?? '').slice(0, 300)}`; out.endedAt = ms(e.ts) }
  }
  return out
}
