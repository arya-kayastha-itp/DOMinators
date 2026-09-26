'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AgentName, AppStatus, BlueprintResult, ConsoleEvent, CutoverRun, CutoverStep, EventType } from '@/lib/contracts'
import { buildBlueprint } from '@/lib/data/blueprint'
import { seedEvents } from '@/lib/data/events'
import { REAL_APP_IDS } from '@/lib/data/fleet'
import { DEFAULT_CAPACITY, buildPlan } from '@/lib/data/planner'

// ---------------------------------------------------------------------------
// Console state + deterministic simulations of the four agents. Everything a
// screen shows flows through here, in CONTRACTS.md shapes, so wiring the real
// orchestrator (POST /runs/*, GET /events SSE) later replaces the bodies of the
// run* actions — not the screens.
// ---------------------------------------------------------------------------

export type AgentState = 'idle' | 'running' | 'done' | 'error'
export type Env = 'legacy' | 'target'

export const BLUEPRINT_STAGES = ['Map inputs', 'Validate schema', 'Render main.tf', 'Build diff', 'terraform plan', 'terraform apply', 'Target healthy'] as const

export type BlueprintState = BlueprintResult & { stage: number; running: boolean; badWave: boolean }

export type SeriesPoint = { t: number; weight: number; target_share: number; error_rate: number; p95: number }

export type CutoverState = {
  run: CutoverRun
  phase: 'precheck' | 'observing' | 'rolling_back' | 'done'
  weight: number
  stepIdx: number
  windowStart: number
  series: SeriesPoint[]
  restoreMs: number | null
  startedAt: number
}

type Ctx = {
  agents: Record<AgentName, AgentState>
  events: ConsoleEvent[]
  env: Env
  setEnv: (e: Env) => void
  badWave: boolean
  setBadWave: (v: boolean) => void
  demoMode: boolean
  capacity: number
  setCapacity: (n: number) => void
  plan: ReturnType<typeof buildPlan>
  statuses: Record<string, AppStatus>
  blueprints: Record<string, BlueprintState>
  cutovers: Record<string, CutoverState>
  manualWeights: Record<string, number>
  discoveryProgress: number | null
  runDiscovery: () => void
  runPlanning: () => void
  runBlueprint: (appId: string, apply: boolean) => void
  runCutover: (appId: string) => void
  runWave1: () => void
  setManualWeight: (appId: string, weight: number) => void
  healthCheck: (appId: string) => void
  reset: () => void
  observeWindowMs: number
}

const ConsoleCtx = createContext<Ctx | null>(null)
export const useConsole = () => {
  const c = useContext(ConsoleCtx)
  if (!c) throw new Error('useConsole must be used inside <ConsoleProvider>')
  return c
}

const OBSERVE_MS = 5000 // compressed demo window (real: 20 s demo / 300 s prod — docs/TRACK_3)
const TICK_MS = 250
const GATES = { max_error_rate: 0.02, max_p95_ms: 800, min_target_share_ratio: 0.8 }

const initialAgents: Record<AgentName, AgentState> = { discovery: 'done', planning: 'done', blueprint: 'idle', cutover: 'idle' }

function seedBlueprints(): Record<string, BlueprintState> {
  // Per the demo script, pricing + orders are pre-applied before judging; catalog applies live.
  const out: Record<string, BlueprintState> = {}
  for (const id of ['app-pricing', 'app-orders']) {
    const b = buildBlueprint(id)
    out[id] = { ...b, applied: true, status: 'PROVISIONED', outputs: { ...b.outputs, instance_ids: [`i-0${id === 'app-pricing' ? '7c1e' : '9a4d'}…target`] }, stage: BLUEPRINT_STAGES.length, running: false, badWave: false }
  }
  return out
}

const initialStatuses = (): Record<string, AppStatus> => ({ 'app-catalog': 'PLANNED', 'app-pricing': 'PROVISIONED', 'app-orders': 'PROVISIONED' })

// Gaussian-ish noise from a seeded-enough source; deterministic enough for a demo.
const jitter = (mean: number, spread: number) => mean + (Math.random() + Math.random() + Math.random() - 1.5) * spread

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState(initialAgents)
  const [events, setEvents] = useState<ConsoleEvent[]>(() => [...seedEvents].reverse())
  const [env, setEnv] = useState<Env>('target')
  const [badWave, setBadWaveState] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY)
  const [statuses, setStatuses] = useState(initialStatuses)
  const [blueprints, setBlueprints] = useState(seedBlueprints)
  const [cutovers, setCutovers] = useState<Record<string, CutoverState>>({})
  const [manualWeights, setManualWeights] = useState<Record<string, number>>({})
  const [discoveryProgress, setDiscoveryProgress] = useState<number | null>(null)
  const plan = useMemo(() => buildPlan(capacity), [capacity])

  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const intervals = useRef<Set<ReturnType<typeof setInterval>>>(new Set())
  const eventId = useRef(1000)
  const blueprintsRef = useRef(blueprints)
  blueprintsRef.current = blueprints

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') === '1') setDemoMode(true)
    return () => {
      timers.current.forEach(clearTimeout)
      intervals.current.forEach(clearInterval)
    }
  }, [])

  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => { timers.current.delete(t); fn() }, ms)
    timers.current.add(t)
  }, [])

  const emit = useCallback((e: { agent: ConsoleEvent['agent']; app_id?: string | null; type: EventType; level?: ConsoleEvent['level']; payload?: Record<string, unknown>; summary: string; decided_by?: 'rules' | 'llm' }) => {
    const full: ConsoleEvent = { id: eventId.current++, ts: new Date().toISOString(), app_id: e.app_id ?? null, level: e.level ?? 'info', payload: e.payload ?? {}, agent: e.agent, type: e.type, summary: e.summary, decided_by: e.decided_by }
    setEvents(prev => [full, ...prev].slice(0, 600))
    return full
  }, [])

  const setAgent = useCallback((name: AgentName, s: AgentState) => setAgents(a => ({ ...a, [name]: s })), [])
  const setStatus = useCallback((appId: string, s: AppStatus) => setStatuses(prev => ({ ...prev, [appId]: s })), [])

  // ------------------------------------------------------------------ discovery
  const runDiscovery = useCallback(() => {
    if (agents.discovery === 'running') return
    setAgent('discovery', 'running')
    setDiscoveryProgress(0)
    emit({ agent: 'discovery', type: 'DISCOVERY_STARTED', summary: 'Assumed mig-discovery-readonly in Account A (two-hop, ExternalId)', payload: { scope: 'all' } })
    const steps = [
      ['app-catalog', 'app-catalog · 7 findings · GOLDEN'],
      ['app-pricing', 'app-pricing · 9 findings · GOLDEN'],
      ['app-orders', 'app-orders · 9 findings · GOLDEN'],
    ] as const
    steps.forEach(([id, s], i) => later(350 + i * 300, () => { emit({ agent: 'discovery', app_id: id, type: 'APP_DISCOVERED', summary: s, decided_by: 'rules' }); setDiscoveryProgress((i + 1) / 23) }))
    for (let b = 0; b < 20; b++) later(1300 + b * 90, () => setDiscoveryProgress((4 + b) / 23))
    later(1500, () => emit({ agent: 'discovery', type: 'APP_DISCOVERED', summary: 'Synthetic fleet: 1,000 records through the same rules (batches of 50)', payload: { batch: 50 } }))
    later(2300, () => emit({ agent: 'discovery', app_id: 'syn-00007', type: 'TOOL_CALL', summary: 'Ambiguous ECS mapping → Claude tiered syn-00007 GRAY', decided_by: 'llm', payload: { tool: 'submit_tiering', args: { app_id: 'syn-00007', tier: 'GRAY' }, result: 'accepted' } }))
    later(3200, () => {
      setDiscoveryProgress(null)
      setAgent('discovery', 'done')
      emit({ agent: 'discovery', type: 'DISCOVERY_DONE', level: 'success', summary: 'Discovery complete · 1,003 apps · 60% Golden', payload: { apps_total: 1003 } })
      toast.success('Discovery complete', { description: '1,003 apps tiered · 3 real apps with 25 findings · edges orders → pricing → catalog' })
    })
  }, [agents.discovery, emit, later, setAgent])

  // ------------------------------------------------------------------ planning
  const runPlanning = useCallback(() => {
    setAgent('planning', 'running')
    later(700, () => {
      setAgent('planning', 'done')
      const p = buildPlan(capacity)
      emit({ agent: 'planning', type: 'PLAN_DONE', level: 'success', decided_by: 'rules', summary: `${p.waves.length} waves · finish ${p.projection.projected_finish} · ${p.projection.meets_target_2027 ? 'meets' : 'misses'} 2027 target`, payload: { capacity_per_wave: capacity, projection: p.projection } })
      toast.success('Wave plan rebuilt', { description: `${p.waves.length} waves at capacity ${capacity} — projected finish ${p.projection.projected_finish}` })
    })
  }, [capacity, emit, later, setAgent])

  // ------------------------------------------------------------------ blueprint
  const runBlueprint = useCallback((appId: string, apply: boolean, onDone?: () => void) => {
    const bad = badWave && appId === 'app-orders'
    const base = buildBlueprint(appId, { badWave: bad })
    setAgent('blueprint', 'running')
    setBlueprints(prev => ({ ...prev, [appId]: { ...base, stage: 0, running: true, badWave: bad } }))
    setStatus(appId, 'BLUEPRINTED')
    const durations = [900, 500, 400, 400, 1100, 2400, 1400]
    const lastStage = apply ? BLUEPRINT_STAGES.length : 5
    let t = 0
    for (let s = 1; s <= lastStage; s++) {
      t += durations[s - 1]
      const stage = s
      later(t, () => {
        setBlueprints(prev => ({ ...prev, [appId]: { ...prev[appId], stage } }))
        if (stage === 1) emit({ agent: 'blueprint', app_id: appId, type: 'TOOL_CALL', summary: `set_golden_inputs(${appId}) — ${base.gaps.length ? `${base.gaps.length} gaps flagged` : 'no gaps'}`, decided_by: 'llm', payload: { tool: 'set_golden_inputs', args: base.inputs } })
        if (stage === 5) emit({ agent: 'blueprint', app_id: appId, type: 'BLUEPRINT_READY', level: 'success', summary: `${appId}: validate ✓ · plan 2 to add · ${base.fixes.length} fixes annotated`, payload: { fixes: base.fixes.length, bad_wave: bad } })
        if (stage === 6) emit({ agent: 'blueprint', app_id: appId, type: 'TOOL_CALL', summary: `terraform apply generated/${appId} (mig-tf-apply)`, payload: { tool: 'terraform_apply' } })
      })
    }
    later(t + 200, () => {
      setBlueprints(prev => ({ ...prev, [appId]: { ...prev[appId], running: false, applied: apply, status: apply ? 'PROVISIONED' : 'BLUEPRINTED', outputs: { ...prev[appId].outputs, instance_ids: apply ? [`i-0${Math.random().toString(16).slice(2, 6)}…target`] : [] } } }))
      setAgent('blueprint', 'done')
      if (apply) {
        setStatus(appId, 'PROVISIONED')
        emit({ agent: 'blueprint', app_id: appId, type: 'PROVISIONED', level: 'success', summary: `${appId} healthy in tg-${appId}-target${bad ? ' (bad-wave variant: UPSTREAM_URL dropped)' : ''}` })
        toast.success(`${appId} provisioned`, { description: bad ? 'Bad-wave variant applied — /health is 200, / will return 500.' : 'New instance healthy in the target group. Ready to cut over.' })
      } else {
        toast.success(`Blueprint ready for ${appId}`, { description: `${base.fixes.length} annotated fixes · terraform validate passed` })
      }
      onDone?.()
    })
  }, [badWave, emit, later, setAgent, setStatus])

  // ------------------------------------------------------------------ cutover
  const runCutover = useCallback((appId: string) => {
    const bp = blueprintsRef.current[appId]
    if (!bp || bp.status !== 'PROVISIONED') {
      emit({ agent: 'cutover', app_id: appId, type: 'CUTOVER_ABORTED', level: 'warn', summary: `${appId}: precheck failed — no healthy target (run Blueprint → apply first)` })
      toast.error(`Can't cut over ${appId} yet`, { description: 'Precheck: tg-target has no healthy instance. Apply the blueprint first — weights untouched.' })
      return
    }
    // Target breaks iff the applied inputs require an upstream but don't have one (app/server.py).
    const broken = bp.inputs.env.REQUIRE_UPSTREAM === '1' && !bp.inputs.env.UPSTREAM_URL
    const runId = `cut-${String(Math.floor(Math.random() * 9000) + 1000)}`
    const steps = [10, 50, 100]
    const now = Date.now()
    setAgent('cutover', 'running')
    setStatus(appId, 'CUTTING_OVER')
    setCutovers(prev => ({ ...prev, [appId]: { run: { run_id: runId, app_id: appId, steps, history: [], result: null, rollback: null, explanation: '' }, phase: 'precheck', weight: 0, stepIdx: -1, windowStart: now, series: [], restoreMs: null, startedAt: now } }))
    emit({ agent: 'cutover', app_id: appId, type: 'CUTOVER_STARTED', summary: `${runId}: precheck tg-${appId}-target → all targets healthy` })

    let weight = 0
    let stepIdx = -1
    let windowStart = 0
    let window: { status: number; latency: number; target: boolean }[] = []
    let finished = false
    let halted = false
    let tailTicks = 0
    // Every async write is scoped to this run: a finished run's tail ticks or delayed explanation
    // must never leak into the next run on the same app.
    const patch = (fn: (c: CutoverState) => CutoverState) =>
      setCutovers(prev => (prev[appId]?.run.run_id === runId ? { ...prev, [appId]: fn(prev[appId]) } : prev))

    const setWeight = (w: number, idx: number) => {
      weight = w; stepIdx = idx; windowStart = Date.now(); window = []
      emit({ agent: 'cutover', app_id: appId, type: 'WEIGHT_SET', summary: `${appId} weights legacy ${100 - w} / target ${w}`, payload: { weight: w, tool: 'elbv2.modify_rule' } })
      patch(c => ({ ...c, phase: 'observing', weight: w, stepIdx: idx, windowStart }))
    }

    const finish = (result: CutoverRun['result'], extra: Partial<CutoverRun> = {}) => {
      finished = true
      patch(c => ({ ...c, phase: 'done', run: { ...c.run, result, ...extra } }))
    }

    later(800, () => setWeight(steps[0], 0))

    const iv = setInterval(() => {
      const t = Date.now()
      if (stepIdx < 0 && !finished) return
      // ~20 req/s through the edge ALB: 5 requests per 250 ms tick.
      const batch = Array.from({ length: 5 }, () => {
        const toTarget = Math.random() * 100 < weight
        const status = toTarget ? (broken ? 500 : Math.random() < 0.002 ? 502 : 200) : Math.random() < 0.001 ? 502 : 200
        const latency = Math.max(18, toTarget ? jitter(86, 40) : jitter(112, 50))
        return { status, latency, target: toTarget }
      })
      if (t - windowStart > 400) window.push(...batch) // skip ALB settle time after WEIGHT_SET
      const recent = batch
      const point: SeriesPoint = {
        t: (t - now) / 1000,
        weight,
        target_share: Math.round((recent.filter(r => r.target).length / recent.length) * 100),
        error_rate: Math.round((recent.filter(r => r.status >= 500).length / recent.length) * 1000) / 10,
        p95: Math.round([...recent].sort((a, b) => a.latency - b.latency)[recent.length - 1].latency),
      }
      patch(c => ({ ...c, series: [...c.series, point].slice(-240) }))

      if (finished) {
        if (++tailTicks > 12) { clearInterval(iv); intervals.current.delete(iv) }
        return
      }
      if (halted || t - windowStart < OBSERVE_MS) return

      // --- gate evaluation: deterministic code, never the LLM ---
      const n = window.length || 1
      const errorRate = window.filter(r => r.status >= 500).length / n
      const lat = window.map(r => r.latency).sort((a, b) => a - b)
      const p95 = Math.round(lat[Math.floor(lat.length * 0.95)] ?? 0)
      const share = window.filter(r => r.target).length / n
      // Share gate must be statistically sound: at 10% weight a 5 s window holds only ~9 target
      // requests, so binomial noise alone breaches a naive 80% ratio. Fail only when the shortfall
      // is both large (< 80% of the weight) AND significant (z < -3) — i.e. traffic really didn't move.
      const pExp = weight / 100
      const z = pExp > 0 && pExp < 1 ? (share - pExp) / Math.sqrt((pExp * (1 - pExp)) / n) : 0
      const shareFails = pExp > 0 && share / pExp < GATES.min_target_share_ratio && z < -3
      const failReason = errorRate > GATES.max_error_rate ? `error_rate ${errorRate.toFixed(2)} > ${GATES.max_error_rate}` : p95 > GATES.max_p95_ms ? `p95 ${p95}ms > ${GATES.max_p95_ms}ms` : shareFails ? `target share ${Math.round(share * 100)}% < 80% of weight (z=${z.toFixed(1)})` : null
      const step: CutoverStep = { weight, ts: new Date().toISOString(), error_rate: Math.round(errorRate * 1000) / 1000, p95_ms: p95, target_share: Math.round(share * 100) / 100, gate: failReason ? 'FAIL' : 'PASS' }
      patch(c => ({ ...c, run: { ...c.run, history: [...c.run.history, step] } }))

      if (failReason) {
        const atWeight = weight
        emit({ agent: 'cutover', app_id: appId, type: 'GATE_FAIL', level: 'error', summary: `Gate failed at ${atWeight}%: ${failReason}`, decided_by: 'rules', payload: step })
        patch(c => ({ ...c, phase: 'rolling_back' }))
        halted = true
        const restoreMs = 600 + Math.floor(Math.random() * 350)
        const w0 = weight
        later(restoreMs, () => {
          weight = 0
          const reason = failReason
          emit({ agent: 'cutover', app_id: appId, type: 'ROLLED_BACK', level: 'error', summary: `${appId} rolled back to legacy 100 / target 0 in ${(restoreMs / 1000).toFixed(1)} s`, payload: { at_weight: w0, reason } })
          setStatus(appId, 'ROLLED_BACK')
          setAgent('cutover', 'error')
          patch(c => ({ ...c, weight: 0, restoreMs }))
          toast.error(`${appId} rolled back automatically`, { description: `${reason} at ${w0}% — legacy restored in ${(restoreMs / 1000).toFixed(1)} s. No human involved.` })
          finish('ROLLED_BACK', { rollback: { at_weight: w0, reason } })
          // Explainer runs AFTER the decision (docs/TRACK_3 T3-C-8).
          later(1400, () => {
            const explanation = broken
              ? `Rolled back at ${w0}%: ${Math.round(errorRate * 100)}% of all requests (≈100% of target responses) were HTTP 500 "missing upstream config". The applied inputs for ${appId} set REQUIRE_UPSTREAM=1 but have no UPSTREAM_URL — the bad-wave variant dropped it after validation. Legacy kept serving; target instance kept for debugging. Fix: re-run Blueprint with the input restored (apply with -replace), then cut over again.`
              : `Rolled back at ${w0}%: ${reason}. Target instance kept for debugging.`
            patch(c => ({ ...c, run: { ...c.run, explanation } }))
            emit({ agent: 'cutover', app_id: appId, type: 'TOOL_CALL', summary: 'Explainer (Claude) summarised the rollback — decision was already made by code', decided_by: 'llm', payload: { tool: 'explain_rollback' } })
          })
        })
        return
      }

      emit({ agent: 'cutover', app_id: appId, type: 'GATE_PASS', level: 'success', decided_by: 'rules', summary: `Gates green at ${weight}% · err ${(errorRate * 100).toFixed(1)}% · p95 ${p95}ms · share ${Math.round(share * 100)}%`, payload: step })
      if (stepIdx + 1 < steps.length) {
        setWeight(steps[stepIdx + 1], stepIdx + 1)
      } else {
        emit({ agent: 'cutover', app_id: appId, type: 'MIGRATED', level: 'success', summary: `${appId} migrated · 100% served by target` })
        emit({ agent: 'orchestrator', app_id: appId, type: 'SIM_DECOMMISSION', summary: `${appId} legacy teardown scheduled (simulated)` })
        setStatus(appId, 'MIGRATED')
        setAgent('cutover', 'done')
        toast.success(`${appId} migrated`, { description: 'All gates passed at 10 → 50 → 100%. Legacy decommission scheduled.' })
        finish('MIGRATED', { explanation: 'All gates passed at every step.' })
      }
    }, TICK_MS)
    intervals.current.add(iv)
  }, [emit, later, setAgent, setStatus])

  // ------------------------------------------------------------------ demo flows
  const runWave1 = useCallback(() => {
    toast('Wave 1 started', { description: badWave ? 'app-orders ships with the bad-wave variant.' : 'Blueprint → apply → cutover for app-orders.' })
    runBlueprint('app-orders', true, () => later(300, () => runCutover('app-orders')))
  }, [badWave, later, runBlueprint, runCutover])

  const setBadWave = useCallback((v: boolean) => {
    setBadWaveState(v)
    emit({ agent: 'orchestrator', app_id: 'app-orders', type: 'SIM_NOTIFY', level: v ? 'warn' : 'info', summary: `Bad-wave variant ${v ? 'ENABLED' : 'disabled'} for app-orders (POST /demo/bad-wave)` })
  }, [emit])

  const setManualWeight = useCallback((appId: string, w: number) => {
    setManualWeights(prev => ({ ...prev, [appId]: w }))
    emit({ agent: 'cutover', app_id: appId, type: 'WEIGHT_SET', level: 'warn', summary: `Manual override: ${appId} legacy ${100 - w} / target ${w} (operator)`, payload: { weight: w, manual: true } })
  }, [emit])

  const healthCheck = useCallback((appId: string) => {
    const bp = blueprintsRef.current[appId]
    const ok = bp?.status === 'PROVISIONED'
    emit({ agent: 'cutover', app_id: appId, type: 'TOOL_CALL', level: ok ? 'success' : 'warn', summary: `describe_target_health tg-${appId}-target → ${ok ? 'healthy' : 'no registered targets'}`, payload: { tool: 'describe_target_health' } })
    if (ok) toast.success('Target group healthy', { description: `tg-${appId}-target: 1/1 healthy · /${appId.replace('app-', '')}/health 200` })
    else toast.warning('No healthy targets', { description: `tg-${appId}-target is empty — apply the blueprint first.` })
  }, [emit])

  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout); timers.current.clear()
    intervals.current.forEach(clearInterval); intervals.current.clear()
    setAgents({ discovery: 'idle', planning: 'idle', blueprint: 'idle', cutover: 'idle' })
    setStatuses(initialStatuses())
    setBlueprints(seedBlueprints())
    setCutovers({})
    setManualWeights({})
    setBadWaveState(false)
    setDiscoveryProgress(null)
    emit({ agent: 'orchestrator', type: 'SIM_NOTIFY', summary: 'Demo reset — all weights 100/0, state cleared (POST /demo/reset)' })
    toast('Demo reset', { description: 'All weights back to legacy 100 / target 0.' })
  }, [emit])

  const value: Ctx = {
    agents, events, env, setEnv, badWave, setBadWave, demoMode, capacity, setCapacity, plan, statuses, blueprints, cutovers, manualWeights, discoveryProgress,
    runDiscovery, runPlanning, runBlueprint: (id, apply) => runBlueprint(id, apply), runCutover, runWave1, setManualWeight, healthCheck, reset,
    observeWindowMs: OBSERVE_MS,
  }
  return <ConsoleCtx.Provider value={value}>{children}</ConsoleCtx.Provider>
}

export { REAL_APP_IDS }
