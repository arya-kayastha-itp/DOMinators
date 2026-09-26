import type { Tier, WavePlan } from '@/lib/contracts'
import { REAL_APP_IDS, edges, fleet } from './fleet'

// Client-side port of the Planning agent (docs/TRACK_2 T2-P-1..4): park Red,
// providers before consumers, Wave 0 = the 3 real apps, Golden before Gray,
// Gray costs 2 slots, 3 waves/week, freeze window 15 Dec – 5 Jan.
// Runs in well under a frame for 1,003 apps, so the capacity slider is live.

export const PLAN_START = '2026-10-05'
export const TARGET_DATE = '2027-12-31'

function inFreeze(d: Date) {
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  return (m === 12 && day >= 15) || (m === 1 && day <= 5)
}

/** Mon / Wed / Fri slots (for 3 waves/week), skipping the freeze window. */
function waveDates(count: number, wavesPerWeek: number, start = PLAN_START): string[] {
  const dows = wavesPerWeek >= 5 ? [1, 2, 3, 4, 5] : wavesPerWeek === 4 ? [1, 2, 4, 5] : wavesPerWeek === 3 ? [1, 3, 5] : wavesPerWeek === 2 ? [1, 4] : [2]
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  while (out.length < count) {
    if (dows.includes(d.getUTCDay()) && !inFreeze(d)) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

function workingDaysBetween(a: string, b: string) {
  let n = 0
  const d = new Date(`${a}T00:00:00Z`)
  const end = new Date(`${b}T00:00:00Z`)
  while (d <= end) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6 && !inFreeze(d)) n++
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return Math.max(n, 1)
}

const tierRank: Record<Tier, number> = { GOLDEN: 0, GRAY: 1, RED: 2 }

export function buildPlan(capacityPerWave = 8, wavesPerWeek = 3): WavePlan {
  const real = new Set<string>(REAL_APP_IDS)
  const parked = fleet.filter(a => a.tier === 'RED').map(a => a.app_id)
  const parkedSet = new Set(parked)
  const schedulable = fleet.filter(a => !parkedSet.has(a.app_id) && !real.has(a.app_id))
  const tierOf = new Map(fleet.map(a => [a.app_id, a.tier]))

  // Kahn's algorithm with a priority queue (Golden first, then id) — providers always
  // land in the same or an earlier wave than their consumers. Edges to parked or real
  // apps are already satisfied (peering keeps cross-environment calls working).
  const ids = new Set(schedulable.map(a => a.app_id))
  const indeg = new Map<string, number>()
  const consumers = new Map<string, string[]>()
  for (const id of ids) indeg.set(id, 0)
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue
    indeg.set(e.from, (indeg.get(e.from) ?? 0) + 1)
    consumers.set(e.to, [...(consumers.get(e.to) ?? []), e.from])
  }
  const ready = [...ids].filter(id => indeg.get(id) === 0)
  const order: string[] = []
  const cmp = (x: string, y: string) => tierRank[tierOf.get(x)!] - tierRank[tierOf.get(y)!] || x.localeCompare(y)
  ready.sort(cmp)
  while (ready.length) {
    const id = ready.shift()!
    order.push(id)
    for (const c of consumers.get(id) ?? []) {
      indeg.set(c, indeg.get(c)! - 1)
      if (indeg.get(c) === 0) {
        // insert keeping priority order
        let i = 0
        while (i < ready.length && cmp(ready[i], c) < 0) i++
        ready.splice(i, 0, c)
      }
    }
  }

  const waves: { app_ids: string[]; used: number }[] = [{ app_ids: [...REAL_APP_IDS], used: 3 }]
  let cur = { app_ids: [] as string[], used: 0 }
  for (const id of order) {
    const cost = tierOf.get(id) === 'GRAY' ? 2 : 1
    if (cur.used + cost > capacityPerWave && cur.app_ids.length) { waves.push(cur); cur = { app_ids: [], used: 0 } }
    cur.app_ids.push(id)
    cur.used += cost
  }
  if (cur.app_ids.length) waves.push(cur)

  const dates = waveDates(waves.length, wavesPerWeek)
  const outWaves = waves.map((w, i) => {
    const mix: Partial<Record<Tier, number>> = {}
    for (const id of w.app_ids) { const t = tierOf.get(id)!; mix[t] = (mix[t] ?? 0) + 1 }
    return {
      wave: i,
      name: i === 0 ? 'Pilot — real apps' : undefined,
      start: dates[i],
      app_ids: w.app_ids,
      tier_mix: mix,
      rationale: i === 0 ? 'The 3 live apps, providers first: catalog → pricing → orders.' : undefined,
    }
  })
  const finish = dates[dates.length - 1]
  const scheduled = order.length + REAL_APP_IDS.length
  return {
    plan_id: `plan-c${capacityPerWave}-w${wavesPerWeek}`,
    generated_at: new Date().toISOString(),
    capacity_per_wave: capacityPerWave,
    waves_per_week: wavesPerWeek,
    waves: outWaves,
    parked,
    projection: {
      apps_total: fleet.length,
      apps_schedulable: scheduled,
      projected_finish: finish,
      apps_per_day: Math.round((scheduled / workingDaysBetween(PLAN_START, finish)) * 10) / 10,
      meets_target_2027: finish <= TARGET_DATE,
    },
  }
}

export const DEFAULT_CAPACITY = 8
