'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, CheckCircle2, ChevronDown, Gauge, Layers3, Loader2, ParkingSquare, Play, Radar, Snowflake, WifiOff, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, ApiError } from '@/lib/api'
import type { AppStatus, Tier, WavePlan } from '@/lib/contracts'
import { TARGET_DATE } from '@/lib/meta'
import { cn } from '@/lib/utils'
import { InfoTip, PageHeader, Reveal, SourceBadge, StatCard, TIER_COLOR_VAR, TIER_LABEL, TierBadge } from '@/components/console/bits'
import { ChartTooltip, Legend, axisProps, gridProps } from '@/components/console/charts'
import { useConsole } from '@/components/console/console-provider'
import { Badge, Card, CardHeader, EmptyState, Segmented, Skeleton, Tip } from '@/components/ui/primitives'

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })

// Planner defaults (orchestrator /plan/preview) — used only until a plan has been committed.
const DEFAULT_CAPACITY = 40
const DEFAULT_WPW = 3
const CAP_MIN = 4
const CAP_MAX = 80
const WPW_OPTIONS = ['1', '2', '3', '4', '5'] as const
type Wpw = (typeof WPW_OPTIONS)[number]
const clampCap = (n: number) => Math.max(CAP_MIN, Math.min(CAP_MAX, n))

const DONE: AppStatus[] = ['MIGRATED']
const FAILED: AppStatus[] = ['ROLLED_BACK', 'FAILED']
const ACTIVE: AppStatus[] = ['BLUEPRINTED', 'PROVISIONED', 'CUTTING_OVER']

type Progress = { total: number; migrated: number; failed: number; active: number }
function progressOf(ids: string[], statuses: Record<string, AppStatus>): Progress {
  const p = { total: ids.length, migrated: 0, failed: 0, active: 0 }
  for (const id of ids) {
    const s = statuses[id]
    if (!s) continue
    if (DONE.includes(s)) p.migrated++
    else if (FAILED.includes(s)) p.failed++
    else if (ACTIVE.includes(s)) p.active++
  }
  return p
}

function ProgressBar({ p, className }: { p: Progress; className?: string }) {
  const w = (n: number) => `${p.total ? (n / p.total) * 100 : 0}%`
  return (
    <div className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} role="img" aria-label={`${p.migrated} of ${p.total} migrated, ${p.active} in progress, ${p.failed} rolled back or failed`}>
      <motion.div className="h-full bg-success" initial={false} animate={{ width: w(p.migrated) }} transition={{ duration: 0.4 }} />
      <motion.div className="h-full bg-primary" initial={false} animate={{ width: w(p.active) }} transition={{ duration: 0.4 }} />
      <motion.div className="h-full bg-destructive" initial={false} animate={{ width: w(p.failed) }} transition={{ duration: 0.4 }} />
    </div>
  )
}

export function PlanView() {
  const { plan, fleetById, statuses, summary, loading, online, agents, isRunning, runPlanning, runWave, runDiscovery } = useConsole()
  const [capacity, setCapacity] = useState(clampCap(plan?.capacity_per_wave ?? DEFAULT_CAPACITY))
  const [wpw, setWpw] = useState<Wpw>(String(plan?.waves_per_week ?? DEFAULT_WPW) as Wpw)
  const [preview, setPreview] = useState<WavePlan | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [openWave, setOpenWave] = useState<number | null>(0)
  const [showAll, setShowAll] = useState(false)
  const discovered = !!summary?.discovered
  const discoveryId = summary?.last_discovery?.id ?? null

  // Snap the controls to whatever plan was just committed (initial load, or a new PLAN_DONE).
  const planId = plan?.plan_id ?? null
  useEffect(() => {
    if (!plan) return
    setCapacity(clampCap(plan.capacity_per_wave))
    setWpw(String(plan.waves_per_week) as Wpw)
  }, [planId]) // eslint-disable-line react-hooks/exhaustive-deps

  const matchesCommitted = !!plan && capacity === plan.capacity_per_wave && Number(wpw) === plan.waves_per_week

  // Real planner, server-side, not saved: debounced so dragging the slider doesn't flood it.
  useEffect(() => {
    if (!discovered || matchesCommitted) { setPreviewLoading(false); return }
    let cancelled = false
    setPreviewLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.planPreview(capacity, Number(wpw))
        if (!cancelled) { setPreview(r); setPreviewError(null) }
      } catch (err) {
        if (!cancelled) setPreviewError(err instanceof ApiError ? err.message : String(err))
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [capacity, wpw, matchesCommitted, discovered, discoveryId])

  const p: WavePlan | null = matchesCommitted ? plan : (preview ?? plan)
  const isPreview = !!p && p !== plan
  const pr = p?.projection

  const monthly = useMemo(() => {
    const m = new Map<string, Record<Tier, number>>()
    for (const w of p?.waves ?? []) {
      const k = w.start.slice(0, 7)
      const row = m.get(k) ?? { GOLDEN: 0, GRAY: 0, RED: 0 }
      for (const t of ['GOLDEN', 'GRAY'] as Tier[]) row[t] += w.tier_mix[t] ?? 0
      m.set(k, row)
    }
    return [...m.entries()].map(([month, v]) => ({ month, ...v }))
  }, [p])

  const committedProgress = useMemo(() => progressOf(plan?.waves.flatMap(w => w.app_ids) ?? [], statuses), [plan, statuses])
  const parked = useMemo(() => {
    const ids = p?.parked ?? []
    return [...ids].sort((a, b) => Number(fleetById.get(b)?.source === 'real') - Number(fleetById.get(a)?.source === 'real'))
  }, [p, fleetById])

  const wave0Real = p?.waves[0]?.app_ids.filter(id => fleetById.get(id)?.source === 'real').length ?? 0
  const description = `Red apps park; providers migrate before consumers; Wave 0 carries every schedulable live app${wave0Real ? ` (${wave0Real} in this plan)` : ''}. Gray apps take two slots because they need a human review.`

  const planning = agents.planning === 'running'
  const waveBusy = isRunning('wave')

  const commitButton = (
    <button onClick={() => { void runPlanning(capacity, Number(wpw)) }} disabled={planning || !discovered || !online} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-elev-1 transition hover:brightness-110 disabled:opacity-60">
      {planning ? <Loader2 className="size-4 animate-spin" /> : <Layers3 className="size-4" />} {plan ? (matchesCommitted ? 'Re-commit plan' : 'Commit plan') : 'Commit plan'}
    </button>
  )

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Plan" title="Wave plan" description="Loading the committed plan from the orchestrator…" />
        <Skeleton className="h-48" />
        <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      </>
    )
  }

  if (!discovered) {
    return (
      <>
        <PageHeader eyebrow="Plan" title="Wave plan" description="Waves are built from the discovered fleet: tiers, dependencies and the planner's capacity rules." />
        <Card>
          {online ? (
            <EmptyState
              icon={<Radar />}
              title="Nothing to plan yet"
              description="The planner needs a discovered fleet. Run discovery first — the wave plan and the 2027 projection are built from its results."
              action={
                <button onClick={() => { void runDiscovery() }} disabled={agents.discovery === 'running'} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-elev-1 transition hover:brightness-110 disabled:opacity-60">
                  {agents.discovery === 'running' ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}{agents.discovery === 'running' ? 'Scanning…' : 'Run discovery'}
                </button>
              }
            />
          ) : (
            <EmptyState icon={<WifiOff />} title="Orchestrator unreachable" description="The console reconnects automatically once the orchestrator is back." />
          )}
        </Card>
      </>
    )
  }

  const lastDate = pr ? Date.parse(`${pr.projected_finish.slice(0, 10)}T00:00:00Z`) : NaN
  const slackDays = Math.round((Date.parse(`${TARGET_DATE}T00:00:00Z`) - lastDate) / 86400000)
  const waves = p ? (showAll ? p.waves : p.waves.slice(0, 10)) : []

  return (
    <>
      <PageHeader eyebrow="Plan" title="Wave plan" description={description} actions={commitButton} />

      <Card className="relative overflow-hidden">
        {pr && <div className={cn('pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l to-transparent opacity-60', pr.meets_target_2027 ? 'from-success/10' : 'from-destructive/10')} />}
        <div className="relative grid grid-cols-1 gap-6 p-5 md:p-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="capacity" className="flex items-center gap-2 text-sm font-medium"><Gauge className="size-4 text-primary" /> Capacity per wave <InfoTip>How many app-slots each wave can absorb. Gray apps cost 2 slots. Every change re-runs the real planner on the orchestrator as a preview — nothing is saved until you commit.</InfoTip></label>
              <span className="flex items-center gap-2">
                {previewLoading && <Loader2 className="size-3.5 animate-spin text-subtle" aria-label="Updating preview" />}
                <span className="rounded-md border bg-surface-2 px-2 py-0.5 font-mono text-sm font-semibold tabular">{capacity}</span>
              </span>
            </div>
            <input
              id="capacity"
              type="range"
              min={CAP_MIN}
              max={CAP_MAX}
              value={capacity}
              onChange={e => setCapacity(Number(e.target.value))}
              className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[var(--primary)]"
              aria-describedby="capacity-help"
            />
            <div id="capacity-help" className="mt-1.5 flex justify-between text-[11px] text-subtle"><span>{CAP_MIN} · cautious</span><span>{CAP_MAX} · aggressive</span></div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">Waves per week</span>
              <Segmented label="Waves per week" value={wpw} onChange={setWpw} size="sm" options={WPW_OPTIONS.map(v => ({ value: v, label: v }))} />
              <Badge tone="neutral"><Snowflake className="size-3" /> Freeze 15 Dec – 5 Jan skipped</Badge>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              {isPreview ? (
                <>
                  <Badge tone="warning">Preview — not committed</Badge>
                  <span className="text-muted-foreground">
                    {plan ? <>Committed plan: {plan.capacity_per_wave} per wave · {plan.waves_per_week}/week</> : 'No plan committed yet.'}
                  </span>
                  {plan && (
                    <button onClick={() => { setCapacity(clampCap(plan.capacity_per_wave)); setWpw(String(plan.waves_per_week) as Wpw) }} className="font-medium text-primary">Reset to committed</button>
                  )}
                </>
              ) : plan ? (
                <>
                  <Badge tone="success"><CheckCircle2 className="size-3" /> Committed</Badge>
                  <span className="text-muted-foreground">Generated {new Date(plan.generated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </>
              ) : (
                <Badge tone="neutral">No plan committed yet</Badge>
              )}
              {previewError && <span className="text-destructive">Preview failed: {previewError}</span>}
            </div>
          </div>
          {pr ? (
            <motion.div key={`${pr.projected_finish}-${pr.meets_target_2027}`} initial={{ opacity: 0.4, scale: 0.98 }} animate={{ opacity: previewLoading ? 0.6 : 1, scale: 1 }} className={cn('rounded-xl border p-5 transition-opacity', pr.meets_target_2027 ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5')}>
              <div className="flex items-center gap-2 text-sm font-medium">
                {pr.meets_target_2027 ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}
                {pr.meets_target_2027 ? `Meets the ${fmt(TARGET_DATE, { month: 'short', year: 'numeric' })} target` : `Misses the ${fmt(TARGET_DATE, { month: 'short', year: 'numeric' })} target`}
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">Finish {fmt(pr.projected_finish, { month: 'long', year: 'numeric' })}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {Number.isFinite(slackDays) && (slackDays >= 0 ? `${slackDays.toLocaleString()} days of buffer before ${fmt(TARGET_DATE)}` : `${(-slackDays).toLocaleString()} days late — raise capacity or waves per week`)}
              </div>
            </motion.div>
          ) : (
            <div className="flex h-full min-h-32 items-center justify-center gap-2 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" /> Running the planner…
            </div>
          )}
        </div>
      </Card>

      {p && pr && (
        <>
          <Reveal className={cn('mt-4 grid grid-cols-2 gap-4 transition-opacity xl:grid-cols-4', previewLoading && 'opacity-60')}>
            <StatCard label="Schedulable apps" value={pr.apps_schedulable} hint={`of ${pr.apps_total.toLocaleString()} discovered`} icon={<Layers3 />} />
            <StatCard label="Waves" value={p.waves.length} hint={p.waves[0] ? `${p.waves_per_week} per week from ${fmt(p.waves[0].start)}` : `${p.waves_per_week} per week`} icon={<CalendarClock />} />
            <StatCard label="Apps per working day" value={pr.apps_per_day} decimals={1} hint="planner projection" icon={<Gauge />} />
            <StatCard label="Parked (Red)" value={p.parked.length} hint="Red tier — engineering queue" icon={<ParkingSquare />} color="var(--red-tier)" />
          </Reveal>

          <Card className="mt-4">
            <CardHeader title="Monthly throughput" description="Apps scheduled per month, stacked by tier" action={<Legend items={[{ label: 'Golden', color: TIER_COLOR_VAR.GOLDEN }, { label: 'Gray', color: TIER_COLOR_VAR.GRAY }]} />} />
            <div className="h-64 px-2 pb-3 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ left: 0, right: 12 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" tickFormatter={m => fmt(`${m}-01`, { month: 'short', year: '2-digit' })} minTickGap={16} {...axisProps} />
                  <YAxis width={36} {...axisProps} />
                  <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip labelFormatter={m => fmt(`${m}-01`, { month: 'long', year: 'numeric' })} formatter={v => `${v} apps`} />} />
                  <Bar dataKey="GOLDEN" name="Golden" stackId="t" fill={TIER_COLOR_VAR.GOLDEN} isAnimationActive={false} />
                  <Bar dataKey="GRAY" name="Gray" stackId="t" fill={TIER_COLOR_VAR.GRAY} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader
              title="Wave schedule"
              description={isPreview
                ? `${p.waves.length} waves in this preview — commit it to run waves`
                : `${p.waves.length} waves · ${committedProgress.migrated.toLocaleString()} of ${committedProgress.total.toLocaleString()} apps migrated${committedProgress.active ? ` · ${committedProgress.active.toLocaleString()} in progress` : ''}${committedProgress.failed ? ` · ${committedProgress.failed.toLocaleString()} rolled back/failed` : ''}`}
              action={!isPreview && committedProgress.total > 0 && <ProgressBar p={committedProgress} className="w-40" />}
            />
            <ol className="flex flex-col gap-1.5 p-3">
              {waves.map(w => {
                const open = openWave === w.wave
                const prog = progressOf(w.app_ids, statuses)
                const thisRunning = isRunning(`wave:${w.wave}`)
                const complete = !isPreview && prog.total > 0 && prog.migrated === prog.total
                const hasReal = w.app_ids.some(id => fleetById.get(id)?.source === 'real')
                const runDisabled = isPreview || waveBusy || !online
                const runHint = isPreview ? 'Commit this plan first' : waveBusy ? 'A wave is already running' : !online ? 'Orchestrator offline' : `Blueprint and cut over every app in wave ${w.wave}`
                return (
                  <li key={w.wave} className={cn('rounded-xl border transition', open ? 'border-border-strong bg-surface-2/50' : thisRunning ? 'border-primary/40 bg-primary/5' : 'border-transparent hover:bg-surface-2/60')}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-3">
                      <button onClick={() => setOpenWave(open ? null : w.wave)} aria-expanded={open} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-left">
                        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-semibold', complete ? 'bg-success text-white' : w.wave === 0 ? 'bg-primary text-primary-foreground' : 'bg-surface-2 text-muted-foreground')}>{complete ? <CheckCircle2 className="size-4" /> : String(w.wave).padStart(2, '0')}</span>
                        <span className="min-w-40 flex-1">
                          <span className="flex items-center gap-2 text-[13.5px] font-medium">{w.name ?? `Wave ${w.wave}`}{hasReal && <SourceBadge source="real" />}</span>
                          <span className="block text-xs text-muted-foreground">{fmt(w.start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · {w.app_ids.length} apps</span>
                        </span>
                        {!isPreview && (prog.migrated + prog.active + prog.failed > 0) && (
                          <span className="flex w-36 flex-col gap-1">
                            <ProgressBar p={prog} />
                            <span className="text-[11px] text-muted-foreground tabular">
                              {prog.migrated}/{prog.total} migrated{prog.active ? ` · ${prog.active} active` : ''}{prog.failed ? ` · ${prog.failed} rolled back` : ''}
                            </span>
                          </span>
                        )}
                        <span className="flex items-center gap-1.5">
                          {(['GOLDEN', 'GRAY'] as Tier[]).filter(t => w.tier_mix[t]).map(t => <Badge key={t} tone={t === 'GOLDEN' ? 'golden' : 'gray'}>{w.tier_mix[t]} {TIER_LABEL[t]}</Badge>)}
                        </span>
                        <ChevronDown className={cn('size-4 text-subtle transition', open && 'rotate-180')} />
                      </button>
                      <Tip content={runHint}>
                        <span className="inline-flex">
                          <button onClick={() => { void runWave(w.wave) }} disabled={runDisabled} aria-label={`Run wave ${w.wave}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs font-medium transition hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50">
                            {thisRunning ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <Play className="size-3.5" />}{thisRunning ? 'Running…' : complete ? `Re-run wave ${w.wave}` : `Run wave ${w.wave}`}
                          </button>
                        </span>
                      </Tip>
                    </div>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="px-3 pb-3 sm:pl-16">
                            {w.rationale && <p className="mb-2 text-xs text-muted-foreground">{w.rationale}</p>}
                            <ul className="flex flex-wrap gap-1.5">
                              {w.app_ids.map(id => {
                                const a = fleetById.get(id)
                                const s = statuses[id]
                                return (
                                  <li key={id} className={cn('flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1 text-xs', s === 'MIGRATED' && 'border-success/40', s && FAILED.includes(s) && 'border-destructive/40')}>
                                    <span className="size-1.5 rounded-full" style={{ background: a ? TIER_COLOR_VAR[a.tier] : 'var(--border-strong)' }} />
                                    <span className="font-mono">{id}</span>
                                    {a && <span className="text-muted-foreground">{a.name}</span>}
                                    {s && !isPreview && (DONE.includes(s) || FAILED.includes(s) || ACTIVE.includes(s)) && (
                                      <span className={cn('font-mono text-[10px]', DONE.includes(s) ? 'text-success' : FAILED.includes(s) ? 'text-destructive' : 'text-primary')}>{s.replace('_', ' ')}</span>
                                    )}
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                )
              })}
            </ol>
            {p.waves.length > 10 && (
              <div className="border-t p-3 text-center">
                <button onClick={() => setShowAll(!showAll)} className="text-xs font-medium text-primary">{showAll ? 'Show first 10 waves' : `Show all ${p.waves.length} waves`}</button>
              </div>
            )}
          </Card>

          <Card className="mt-4">
            <CardHeader title={`Parked for engineering · ${p.parked.length}`} description="Red apps are never forced through — each carries its reason" />
            {parked.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">No apps parked.</p>
            ) : (
              <>
                <ul className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
                  {parked.slice(0, 9).map(id => {
                    const a = fleetById.get(id)
                    return (
                      <li key={id} className="rounded-lg border p-3 text-xs">
                        <div className="flex items-center gap-2"><span className="font-mono">{id}</span>{a?.source === 'real' && <SourceBadge source="real" />}<TierBadge tier="RED" className="ml-auto" /></div>
                        {a && <p className="mt-1 text-muted-foreground">{a.tiering.risk_summary}</p>}
                      </li>
                    )
                  })}
                </ul>
                {parked.length > 9 && <p className="px-4 pb-4 text-xs text-subtle">+{(parked.length - 9).toLocaleString()} more parked apps — filter the fleet by Red tier to see them all.</p>}
              </>
            )}
          </Card>
        </>
      )}
    </>
  )
}
