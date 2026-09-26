'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, CheckCircle2, ChevronDown, Gauge, Layers3, Loader2, ParkingSquare, Snowflake, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Tier } from '@/lib/contracts'
import { fleetById } from '@/lib/data/fleet'
import { buildPlan } from '@/lib/data/planner'
import { cn } from '@/lib/utils'
import { InfoTip, PageHeader, Reveal, StatCard, TIER_COLOR_VAR, TIER_LABEL, TierBadge } from '@/components/console/bits'
import { ChartTooltip, Legend, axisProps, gridProps } from '@/components/console/charts'
import { useConsole } from '@/components/console/console-provider'
import { Badge, Card, CardHeader, Segmented } from '@/components/ui/primitives'

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })

export function PlanView() {
  const { capacity, setCapacity, plan, runPlanning, agents } = useConsole()
  const [wpw, setWpw] = useState<'2' | '3' | '5'>('3')
  const [openWave, setOpenWave] = useState<number | null>(0)
  const [showAll, setShowAll] = useState(false)
  const p = useMemo(() => (wpw === '3' ? plan : buildPlan(capacity, Number(wpw))), [plan, capacity, wpw])
  const pr = p.projection

  const monthly = useMemo(() => {
    const m = new Map<string, Record<Tier, number>>()
    for (const w of p.waves) {
      const k = w.start.slice(0, 7)
      const row = m.get(k) ?? { GOLDEN: 0, GRAY: 0, RED: 0 }
      for (const t of ['GOLDEN', 'GRAY'] as Tier[]) row[t] += w.tier_mix[t] ?? 0
      m.set(k, row)
    }
    return [...m.entries()].map(([month, v]) => ({ month, ...v }))
  }, [p])

  const lastDate = new Date(`${pr.projected_finish}T00:00:00Z`)
  const slackDays = Math.round((Date.parse('2027-12-31T00:00:00Z') - lastDate.getTime()) / 86400000)
  const waves = showAll ? p.waves : p.waves.slice(0, 10)

  return (
    <>
      <PageHeader
        eyebrow="Plan"
        title="Wave plan"
        description="Red apps park; providers migrate before consumers; Wave 0 is always the 3 live apps. Gray apps take two slots because they need a human review."
        actions={
          <button onClick={runPlanning} disabled={agents.planning === 'running'} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-elev-1 transition hover:brightness-110 disabled:opacity-60">
            {agents.planning === 'running' ? <Loader2 className="size-4 animate-spin" /> : <Layers3 className="size-4" />} Commit plan
          </button>
        }
      />

      <Card className="relative overflow-hidden">
        <div className={cn('pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l to-transparent opacity-60', pr.meets_target_2027 ? 'from-success/10' : 'from-destructive/10')} />
        <div className="relative grid grid-cols-1 gap-6 p-5 md:p-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="capacity" className="flex items-center gap-2 text-sm font-medium"><Gauge className="size-4 text-primary" /> Capacity per wave <InfoTip>How many app-slots each wave can absorb. Gray apps cost 2 slots. The planner re-runs on every change — 1,003 apps in well under a frame.</InfoTip></label>
              <span className="rounded-md border bg-surface-2 px-2 py-0.5 font-mono text-sm font-semibold tabular">{capacity}</span>
            </div>
            <input
              id="capacity"
              type="range"
              min={4}
              max={40}
              value={capacity}
              onChange={e => setCapacity(Number(e.target.value))}
              className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[var(--primary)]"
              aria-describedby="capacity-help"
            />
            <div id="capacity-help" className="mt-1.5 flex justify-between text-[11px] text-subtle"><span>4 · cautious</span><span>40 · aggressive</span></div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">Waves per week</span>
              <Segmented label="Waves per week" value={wpw} onChange={setWpw} size="sm" options={[{ value: '2', label: '2' }, { value: '3', label: '3' }, { value: '5', label: '5' }]} />
              <Badge tone="neutral"><Snowflake className="size-3" /> Freeze 15 Dec – 5 Jan skipped</Badge>
            </div>
          </div>
          <motion.div key={`${pr.projected_finish}-${pr.meets_target_2027}`} initial={{ opacity: 0.4, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className={cn('rounded-xl border p-5', pr.meets_target_2027 ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5')}>
            <div className="flex items-center gap-2 text-sm font-medium">
              {pr.meets_target_2027 ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}
              {pr.meets_target_2027 ? 'Meets the end-of-2027 target' : 'Misses the end-of-2027 target'}
            </div>
            <div className="mt-2 text-3xl font-semibold tracking-tight">Finish {fmt(pr.projected_finish, { month: 'long', year: 'numeric' })}</div>
            <div className="mt-1 text-sm text-muted-foreground">{slackDays >= 0 ? `${slackDays} days of buffer before 31 Dec 2027` : `${-slackDays} days late — raise capacity or waves per week`}</div>
          </motion.div>
        </div>
      </Card>

      <Reveal className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Schedulable apps" value={pr.apps_schedulable} hint={`of ${pr.apps_total.toLocaleString()} discovered`} icon={<Layers3 />} />
        <StatCard label="Waves" value={p.waves.length} hint={`${p.waves_per_week} per week from ${fmt(p.waves[0].start)}`} icon={<CalendarClock />} />
        <StatCard label="Apps per working day" value={pr.apps_per_day} decimals={1} hint="rolling average" icon={<Gauge />} />
        <StatCard label="Parked (Red)" value={p.parked.length} hint="stateful or licensing — engineering queue" icon={<ParkingSquare />} color="var(--red-tier)" />
      </Reveal>

      <Card className="mt-4">
        <CardHeader title="Monthly throughput" description="Apps cut over per month, stacked by tier" action={<Legend items={[{ label: 'Golden', color: TIER_COLOR_VAR.GOLDEN }, { label: 'Gray', color: TIER_COLOR_VAR.GRAY }]} />} />
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
        <CardHeader title="Wave schedule" description={`${p.waves.length} waves — expand one to see its apps`} />
        <ol className="flex flex-col gap-1.5 p-3">
          {waves.map(w => {
            const open = openWave === w.wave
            return (
              <li key={w.wave} className={cn('rounded-xl border transition', open ? 'border-border-strong bg-surface-2/50' : 'border-transparent hover:bg-surface-2/60')}>
                <button onClick={() => setOpenWave(open ? null : w.wave)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-left">
                  <span className={cn('flex size-9 items-center justify-center rounded-lg font-mono text-sm font-semibold', w.wave === 0 ? 'bg-primary text-primary-foreground' : 'bg-surface-2 text-muted-foreground')}>{String(w.wave).padStart(2, '0')}</span>
                  <span className="min-w-40 flex-1">
                    <span className="block text-[13.5px] font-medium">{w.name ?? `Wave ${w.wave}`}</span>
                    <span className="block text-xs text-muted-foreground">{fmt(w.start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · {w.app_ids.length} apps</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {(['GOLDEN', 'GRAY'] as Tier[]).filter(t => w.tier_mix[t]).map(t => <Badge key={t} tone={t === 'GOLDEN' ? 'golden' : 'gray'}>{w.tier_mix[t]} {TIER_LABEL[t]}</Badge>)}
                  </span>
                  <ChevronDown className={cn('size-4 text-subtle transition', open && 'rotate-180')} />
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="px-3 pb-3 sm:pl-16">
                        {w.rationale && <p className="mb-2 text-xs text-muted-foreground">{w.rationale}</p>}
                        <ul className="flex flex-wrap gap-1.5">
                          {w.app_ids.map(id => { const a = fleetById.get(id)!; return <li key={id} className="flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1 text-xs"><span className="size-1.5 rounded-full" style={{ background: TIER_COLOR_VAR[a.tier] }} /><span className="font-mono">{id}</span><span className="text-muted-foreground">{a.name}</span></li> })}
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
        <ul className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {p.parked.slice(0, 9).map(id => { const a = fleetById.get(id)!; return (
            <li key={id} className="rounded-lg border p-3 text-xs"><div className="flex items-center gap-2"><span className="font-mono">{id}</span><TierBadge tier="RED" className="ml-auto" /></div><p className="mt-1 text-muted-foreground">{a.tiering.risk_summary}</p></li>
          ) })}
        </ul>
      </Card>
    </>
  )
}
