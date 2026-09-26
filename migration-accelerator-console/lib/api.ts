// Typed client for the orchestrator (orchestrator/main.py). Base URL from
// NEXT_PUBLIC_API_BASE, default http://localhost:8000.
import type { AppStatus, BlueprintResult, ConsoleEvent, CutoverRun, Edge, Tier, WavePlan } from '@/lib/contracts'
import type { FleetApp } from '@/lib/meta'

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(public status: number, message: string, public kind?: string) {
    super(message)
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(0, `Orchestrator unreachable at ${API_BASE}`)
  }
  if (!res.ok) {
    let detail = res.statusText
    let kind: string | undefined
    try {
      const j = await res.json()
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
      kind = j.kind
    } catch { /* not JSON */ }
    throw new ApiError(res.status, detail, kind)
  }
  return (await res.json()) as T
}

export const get = <T,>(path: string) => call<T>('GET', path)
export const post = <T,>(path: string, body?: unknown) => call<T>('POST', path, body ?? {})

// ---------------------------------------------------------------- response shapes

export type TierCounts = Record<Tier, number>

export type RealAppSummary = {
  app_id: string; name: string; status: AppStatus; tier: Tier | null; score: number | null
  findings: number; depends_on: string[]; stateful: boolean
}

export type Summary = {
  discovered: boolean
  apps_total: number; real: number; synthetic: number
  tiers: TierCounts; tiers_real: TierCounts; tiers_synthetic: TierCounts
  statuses: Partial<Record<AppStatus, number>>
  statuses_real: Partial<Record<AppStatus, number>>
  statuses_synthetic: Partial<Record<AppStatus, number>>
  findings: Record<string, number>; findings_real: Record<string, number>
  findings_real_total: number; finding_codes_seen: number
  edges: number; edges_real: number; llm_decisions: number
  last_discovery: ({ id: number; ts: string; duration_ms: number; apps_total: number; real: number; synthetic: number; llm_decisions: number } & Record<string, unknown>) | null
  real_apps: RealAppSummary[]
  plan: null | {
    plan_id: string; generated_at: string; capacity_per_wave: number; waves_per_week: number
    waves: number; parked: number; wave0: string[]; first_wave_start: string | null
    projection: WavePlan['projection']
  }
  cutovers_real: Record<string, CutoverRun>
}

export type Capability = {
  provision: boolean; cutover: boolean; reason: string | null
  runtime: string | null; path_prefix: string | null; listener_port: number | null
}

export type DemoState = {
  bad_wave: Record<string, boolean>
  running: string[]
  capabilities: Record<string, Capability>
  cutover_config: {
    steps: number[]; observe_window_s: number; settle_s: number; min_requests: number
    gates: { max_error_rate: number; max_p95_ms: number; min_target_share_ratio: number; require_healthy_targets: boolean }
  }
  llm: { backend: string; model: string | null }
  target: { alb_dns_name: string; region: string; account_id: string } | null
  generated: string[]
}

export type TrafficBucket = { t: number; n: number; target: number; legacy: number; unknown: number; errors: number; p95_ms: number | null }

export type LiveWeights = { app_id: string; legacy?: number; target?: number; target_healthy: boolean; read_at: number }

export type CopilotAnswer = { answer: string; model: string | null; fallback: boolean; facts: string[] }

export type RunAccepted = { run_id: string; status: 'STARTED' }

// ---------------------------------------------------------------- endpoints

export const api = {
  health: () => get<{ ok: boolean; llm_backend: string; llm_model: string | null; terraform: boolean; target_outputs: boolean }>('/healthz'),
  summary: () => get<Summary>('/summary'),
  demoState: () => get<DemoState>('/demo/state'),
  fleet: () => get<FleetApp[]>('/fleet'),
  statuses: () => get<Record<string, AppStatus>>('/statuses'),
  edges: () => get<Edge[]>('/edges'),
  plan: () => get<WavePlan | null>('/plan'),
  planPreview: (capacity: number, wpw: number) => get<WavePlan | null>(`/plan/preview?capacity_per_wave=${capacity}&waves_per_week=${wpw}`),
  blueprints: () => get<Record<string, BlueprintResult>>('/blueprints?source=real'),
  blueprint: (id: string) => get<BlueprintResult | null>(`/blueprints/${id}`),
  cutovers: () => get<Record<string, CutoverRun>>('/cutovers?source=real'),
  traffic: (id: string, seconds = 180) => get<TrafficBucket[]>(`/traffic/${id}?seconds=${seconds}`),
  weights: (id: string) => get<LiveWeights>(`/weights/${id}`),
  recentEvents: (limit = 400) => get<{ events: ConsoleEvent[]; last_id: number }>(`/events/recent?limit=${limit}`),
  runDiscovery: () => post<RunAccepted>('/runs/discovery', { scope: 'all' }),
  runPlanning: (capacity_per_wave: number, waves_per_week: number) => post<RunAccepted>('/runs/planning', { capacity_per_wave, waves_per_week }),
  runBlueprint: (id: string, apply: boolean) => post<RunAccepted>(`/runs/blueprint/${id}?apply=${apply}`),
  runRetry: (id: string) => post<RunAccepted>(`/runs/retry/${id}`),
  runCutover: (id: string) => post<RunAccepted>(`/runs/cutover/${id}`),
  runWave: (n: number) => post<RunAccepted>(`/runs/wave/${n}`),
  badWave: (app_id: string, enabled: boolean) => post<{ bad_wave: Record<string, boolean> }>('/demo/bad-wave', { app_id, enabled }),
  setWeight: (id: string, target_pct: number) => post<{ ok: boolean }>(`/demo/weights/${id}`, { target_pct }),
  reset: (destroy: boolean) => post<RunAccepted>(`/demo/reset?destroy=${destroy}`),
  copilot: (question: string) => post<CopilotAnswer>('/copilot', { question }),
}
