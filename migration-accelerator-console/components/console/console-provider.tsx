'use client'

// Live data layer: everything here comes from the orchestrator (orchestrator/main.py).
// State = REST snapshots + the SSE event stream (GET /events). Each event
// triggers a targeted refetch of whatever it changes; nothing is simulated
// in the browser.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, API_BASE, ApiError, setOperatorKey, type DemoState, type Summary } from '@/lib/api'
import type { AgentName, AppStatus, BlueprintResult, ConsoleEvent, CutoverRun, Edge, WavePlan } from '@/lib/contracts'
import type { FleetApp } from '@/lib/meta'

export type AgentState = 'idle' | 'running' | 'done' | 'error'
export type Env = 'legacy' | 'target'

const MAX_EVENTS = 3000
const FULL_RELOAD = new Set(['DISCOVERY_DONE', 'PLAN_DONE'])
const STATUS_EVENTS = new Set(['BLUEPRINT_READY', 'BLUEPRINT_DRY_RUN', 'PROVISIONED', 'BLUEPRINT_FAILED', 'CUTOVER_STARTED', 'MIGRATED', 'ROLLED_BACK', 'CUTOVER_ABORTED', 'GATE_FAIL', 'ERROR', 'SIM_NOTIFY'])

type Ctx = {
  online: boolean
  loading: boolean
  error: string | null
  summary: Summary | null
  fleet: FleetApp[]
  fleetById: Map<string, FleetApp>
  edges: Edge[]
  plan: WavePlan | null
  statuses: Record<string, AppStatus>
  events: ConsoleEvent[]
  demo: DemoState | null
  blueprints: Record<string, BlueprintResult>
  cutovers: Record<string, CutoverRun>
  realAppIds: string[]
  agents: Record<AgentName, AgentState>
  isRunning: (key: string) => boolean
  badWave: boolean
  env: Env
  setEnv: (e: Env) => void
  demoMode: boolean
  // View-only unless the operator key is entered (deployed console); local dev has no key.
  readOnly: boolean
  operatorRequired: boolean
  unlock: (key: string) => Promise<boolean>
  lock: () => void
  runDiscovery: () => Promise<boolean>
  runPlanning: (capacity?: number, wavesPerWeek?: number) => Promise<boolean>
  runBlueprint: (appId: string, apply: boolean) => Promise<boolean>
  runRetry: (appId: string) => Promise<boolean>
  runCutover: (appId: string) => Promise<boolean>
  runWave: (n: number) => Promise<boolean>
  setBadWave: (v: boolean, appId?: string) => Promise<boolean>
  setManualWeight: (appId: string, weight: number) => Promise<boolean>
  reset: (destroy: boolean) => Promise<boolean>
  refresh: () => void
}

const ConsoleCtx = createContext<Ctx | null>(null)

export function useConsole() {
  const c = useContext(ConsoleCtx)
  if (!c) throw new Error('useConsole must be used inside <ConsoleProvider>')
  return c
}

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [fleet, setFleet] = useState<FleetApp[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [plan, setPlan] = useState<WavePlan | null>(null)
  const [statuses, setStatuses] = useState<Record<string, AppStatus>>({})
  const [events, setEvents] = useState<ConsoleEvent[]>([])
  const [demo, setDemo] = useState<DemoState | null>(null)
  const [blueprints, setBlueprints] = useState<Record<string, BlueprintResult>>({})
  const [cutovers, setCutovers] = useState<Record<string, CutoverRun>>({})
  const [env, setEnv] = useState<Env>('target')
  const [demoMode, setDemoMode] = useState(false)
  const [auth, setAuth] = useState<{ required: boolean; valid: boolean }>({ required: false, valid: true })
  const lastId = useRef(0)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    setDemoMode(new URLSearchParams(window.location.search).get('demo') === '1')
    let stored = ''
    try { stored = sessionStorage.getItem('mac.operatorKey') ?? '' } catch { /* storage blocked */ }
    setOperatorKey(stored)
    api.auth().then(a => setAuth({ required: a.operator_required, valid: a.valid })).catch(() => {})
  }, [])

  const unlock = useCallback(async (key: string) => {
    setOperatorKey(key.trim())
    try {
      const a = await api.auth()
      setAuth({ required: a.operator_required, valid: a.valid })
      if (a.valid) { try { sessionStorage.setItem('mac.operatorKey', key.trim()) } catch { /* ignore */ } toast.success('Operator mode unlocked') }
      else { setOperatorKey(''); toast.error('That operator key is not valid') }
      return a.valid
    } catch {
      setOperatorKey('')
      toast.error('Could not check the key — orchestrator unreachable')
      return false
    }
  }, [])
  const lock = useCallback(() => {
    setOperatorKey('')
    try { sessionStorage.removeItem('mac.operatorKey') } catch { /* ignore */ }
    setAuth(a => ({ ...a, valid: !a.required }))
  }, [])

  // ---------------------------------------------------------------- loaders
  const loadDemo = useCallback(async () => { try { setDemo(await api.demoState()); setOnline(true) } catch { setOnline(false) } }, [])
  const loadStatus = useCallback(async () => {
    const [s, st] = await Promise.all([api.statuses(), api.summary()])
    setStatuses(s); setSummary(st)
  }, [])
  const loadRuns = useCallback(async () => {
    const [b, c] = await Promise.all([api.blueprints(), api.cutovers()])
    setBlueprints(b); setCutovers(c)
  }, [])
  const loadAll = useCallback(async () => {
    try {
      const [f, e, p, s, st, d] = await Promise.all([api.fleet(), api.edges(), api.plan(), api.statuses(), api.summary(), api.demoState()])
      setFleet(f); setEdges(e); setPlan(p); setStatuses(s); setSummary(st); setDemo(d)
      await loadRuns()
      setOnline(true); setError(null)
    } catch (err) {
      setOnline(false)
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [loadRuns])

  const debounced = useCallback((key: string, fn: () => unknown, wait = 350) => {
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => { Promise.resolve(fn()).catch(() => {}) }, wait)
  }, [])

  // ---------------------------------------------------------------- initial load + SSE
  useEffect(() => {
    let es: EventSource | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout>

    const onEvent = (e: ConsoleEvent) => {
      if (e.id <= lastId.current) return
      lastId.current = e.id
      setEvents(prev => [e, ...prev].slice(0, MAX_EVENTS))
      if (FULL_RELOAD.has(e.type)) debounced('all', loadAll, 400)
      else if (STATUS_EVENTS.has(e.type)) {
        debounced('status', loadStatus)
        debounced('runs', loadRuns, 500)
      }
      if (e.type === 'SIM_NOTIFY' && e.payload?.reset) debounced('all', loadAll, 200)
      debounced('demo', loadDemo, 250)
    }

    const connect = () => {
      if (closed) return
      es = new EventSource(`${API_BASE}/events?after=${lastId.current}`)
      es.onopen = () => setOnline(true)
      es.onmessage = m => { try { onEvent(JSON.parse(m.data)) } catch { /* ignore malformed */ } }
      es.addEventListener('reset', () => { lastId.current = 0; setEvents([]); debounced('all', loadAll, 100) })
      es.onerror = () => {
        setOnline(false)
        es?.close()
        retry = setTimeout(connect, 2000)
      }
    }

    ;(async () => {
      await loadAll()
      try {
        const r = await api.recentEvents(1500)
        lastId.current = r.last_id
        setEvents(r.events.slice().reverse())
      } catch { /* offline: connect() will retry */ }
      connect()
    })()

    const poll = setInterval(loadDemo, 3000)
    return () => { closed = true; es?.close(); clearTimeout(retry); clearInterval(poll) }
  }, [loadAll, loadDemo, loadRuns, loadStatus, debounced])

  // ---------------------------------------------------------------- derived
  const fleetById = useMemo(() => new Map(fleet.map(a => [a.app_id, a])), [fleet])
  const realAppIds = useMemo(() => fleet.filter(a => a.source === 'real').map(a => a.app_id), [fleet])
  const running = demo?.running ?? []
  const isRunning = useCallback((key: string) => running.some(r => r === key || r.startsWith(`${key}:`) || r.endsWith(`:${key}`)), [running])

  const agents = useMemo<Record<AgentName, AgentState>>(() => {
    const has = (k: string) => running.some(r => r === k || r.startsWith(`${k}:`))
    const lastErr = (agent: string) => {
      const e = events.find(x => x.agent === agent && ['ERROR', 'BLUEPRINT_FAILED', 'CUTOVER_ABORTED', 'DISCOVERY_DONE', 'PLAN_DONE', 'PROVISIONED', 'MIGRATED', 'ROLLED_BACK', 'BLUEPRINT_READY'].includes(x.type))
      return e ? ['ERROR', 'BLUEPRINT_FAILED', 'CUTOVER_ABORTED'].includes(e.type) : false
    }
    const state = (runningNow: boolean, done: boolean, agent: string): AgentState => runningNow ? 'running' : lastErr(agent) ? 'error' : done ? 'done' : 'idle'
    return {
      discovery: state(has('discovery'), !!summary?.discovered, 'discovery'),
      planning: state(has('planning'), !!plan, 'planning'),
      blueprint: state(has('blueprint') || has('retry') || has('wave'), Object.keys(blueprints).length > 0, 'blueprint'),
      cutover: state(has('cutover') || has('wave'), Object.keys(cutovers).length > 0, 'cutover'),
    }
  }, [running, events, summary, plan, blueprints, cutovers])

  // ---------------------------------------------------------------- actions
  const act = useCallback(async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast.success(ok)
      loadDemo()
      return true
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        toast.error(`${label} needs the operator key`, { description: 'This console is view-only for visitors. Unlock operator mode in the top bar.' })
        setAuth(a => ({ ...a, valid: false }))
        return false
      }
      const msg = err instanceof ApiError ? err.message : String(err)
      toast.error(`${label}: ${msg}`)
      return false
    }
  }, [loadDemo])

  const value: Ctx = {
    online, loading, error, summary, fleet, fleetById, edges, plan, statuses, events, demo, blueprints, cutovers, realAppIds,
    agents, isRunning,
    badWave: !!demo?.bad_wave?.['app-orders'],
    env, setEnv, demoMode,
    readOnly: auth.required && !auth.valid,
    operatorRequired: auth.required,
    unlock, lock,
    runDiscovery: () => act('Discovery', api.runDiscovery, 'Discovery started — scanning Account A'),
    runPlanning: (capacity, wpw) => act('Planning', () => api.runPlanning(capacity ?? plan?.capacity_per_wave ?? 40, wpw ?? plan?.waves_per_week ?? 3), 'Planning started'),
    runBlueprint: (id, apply) => act('Blueprint', () => api.runBlueprint(id, apply), apply ? `Blueprint + terraform apply started for ${id}` : `Blueprint dry run started for ${id}`),
    runRetry: id => act('Fix & retry', () => api.runRetry(id), `Fix & retry started for ${id}`),
    runCutover: id => act('Cutover', () => api.runCutover(id), `Cutover started for ${id} — live ALB traffic`),
    runWave: n => act(`Wave ${n}`, () => api.runWave(n), `Wave ${n} started`),
    setBadWave: (v, id = 'app-orders') => act('Bad wave', () => api.badWave(id, v)),
    setManualWeight: (id, w) => act('Set weights', () => api.setWeight(id, w), `ALB weights for ${id} → ${100 - w}/${w}`),
    reset: destroy => act('Reset', () => api.reset(destroy), destroy ? 'Reset started — destroying target instances' : 'Reset started'),
    refresh: () => { loadAll() },
  }

  return <ConsoleCtx.Provider value={value}>{children}</ConsoleCtx.Provider>
}
