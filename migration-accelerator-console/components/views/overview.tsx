'use client'

import { motion } from 'framer-motion'
import { ArrowRight, Boxes, CalendarCheck2, CheckCircle2, CircleDashed, Layers3, Loader2, Radar, Rocket, ShieldCheck, Sparkles, Target, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AgentName, FindingCode, Tier } from '@/lib/contracts'
import { FINDING_CODES } from '@/lib/contracts'
import { FINDING_META, fleet } from '@/lib/data/fleet'
import { PLAN_START, TARGET_DATE } from '@/lib/data/planner'
import { cn } from '@/lib/utils'
import { PageHeader, Reveal, RevealItem, StatCard, TIER_COLOR_VAR, TIER_LABEL, stagger } from '@/components/console/bits'
import { ChartTooltip, Legend, axisProps, gridProps } from '@/components/console/charts'
import { useConsole, type AgentState } from '@/components/console/console-provider'
import { useShell } from '@/components/shell/app-shell'
import { Badge, Card, CardHeader, CountUp, Progress } from '@/components/ui/primitives'
import { ActivityFeed } from './activity'

const fmtMonth = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const fmtLong = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

const STEPS: { key: AgentName; label: string; icon: React.ComponentType<{ className?: string }>; href: string; detail: string }[] = [
  { key: 'discovery', label: 'Discover', icon: Radar, href: '/fleet', detail: '1,003 apps · 25 real findings' },
  { key: 'planning', label: 'Plan', icon: Layers3, href: '/plan', detail: 'Dependency-ordered waves' },
  { key: 'blueprint', label: 'Blueprint', icon: ShieldCheck, href: '/blueprint', detail: 'Legacy → golden_app' },
  { key: 'cutover', label: 'Cut over', icon: Rocket, href: '/cutover', detail: '10 → 50 → 100% with gates' },
]
const stateIcon = (s: AgentState) => s === 'running' ? <Loader2 className="size-3.5 animate-spin text-primary" /> : s === 'done' ? <CheckCircle2 className="size-3.5 text-success" /> : s === 'error' ? <XCircle className="size-3.5 text-destructive" /> : <CircleDashed className="size-3.5 text-subtle" />

function Hero() {
  const { plan, agents, runDiscovery } = useConsole()
  const { openCopilot } = useShell()
  const p = plan.projection
  return (
    <Card className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-brand-2/15 blur-3xl" />
      <div className="relative grid grid-cols-1 gap-8 p-6 md:p-8 xl:grid-cols-[1.1fr_1fr] xl:items-center">
        <div>
          <Badge tone="brand"><Sparkles className="size-3" /> Agentic migration · Claude on Bedrock</Badge>
          <h2 className="mt-4 text-3xl font-semibold leading-[1.1] tracking-tight md:text-[40px]">
            3–4 years of migration,<br /><span className="text-gradient">done by {new Date(`${p.projected_finish}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}.</span>
          </h2>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Four agents discover, plan, rebuild and cut over {fleet.length.toLocaleString()} applications onto a hardened landing zone — with deterministic guardrails and an audit trail for every decision.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button onClick={runDiscovery} disabled={agents.discovery === 'running'} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-elev-2 transition hover:brightness-110 disabled:opacity-60">
              {agents.discovery === 'running' ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />} Run discovery
            </button>
            <Link href="/plan" className="inline-flex h-10 items-center gap-2 rounded-lg border bg-card px-4 text-sm font-medium transition hover:border-border-strong">View wave plan <ArrowRight className="size-4" /></Link>
            <button onClick={() => openCopilot('Summarize fleet risk')} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition hover:text-foreground"><Sparkles className="size-4 text-primary" /> Ask Copilot</button>
          </div>
        </div>
        <motion.ol initial="hidden" animate="show" variants={stagger} className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Agent pipeline">
          {STEPS.map((s, i) => (
            <motion.li key={s.key} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
              <Link href={s.href} className={cn('glass group flex items-start gap-3 rounded-xl border p-3.5 transition hover:border-border-strong hover:shadow-elev-2', agents[s.key] === 'running' && 'border-primary/40 glow-brand', agents[s.key] === 'error' && 'border-destructive/40')}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"><s.icon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold"><span className="font-mono text-[11px] text-subtle">0{i + 1}</span>{s.label}<span className="ml-auto">{stateIcon(agents[s.key])}</span></span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{s.detail}</span>
                </span>
              </Link>
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </Card>
  )
}

function BurnUp() {
  const { plan } = useConsole()
  const data = useMemo(() => {
    const byMonth = new Map<string, number>()
    let cum = 0
    for (const w of plan.waves) { cum += w.app_ids.length; byMonth.set(w.start.slice(0, 7), cum) }
    const total = plan.projection.apps_schedulable
    const start = new Date(`${PLAN_START}T00:00:00Z`)
    const end = new Date(`${TARGET_DATE}T00:00:00Z`)
    const out: { month: string; planned: number | null; target: number }[] = []
    let last = 0
    for (const d = new Date(start); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const key = d.toISOString().slice(0, 7)
      if (byMonth.has(key)) last = byMonth.get(key)!
      const frac = (d.getTime() - start.getTime()) / (end.getTime() - start.getTime())
      out.push({ month: `${key}-01`, planned: last, target: Math.round(total * frac) })
    }
    return out
  }, [plan])
  const p = plan.projection
  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Migration burn-up"
        description={`Cumulative apps cut over vs. a straight line to ${fmtLong(TARGET_DATE)}`}
        action={<Badge tone={p.meets_target_2027 ? 'success' : 'danger'}><Target className="size-3" />{p.meets_target_2027 ? 'Ahead of target' : 'Misses 2027'}</Badge>}
      />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="h-64 px-2 pb-2 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="burn" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="month" tickFormatter={fmtMonth} minTickGap={28} {...axisProps} />
            <YAxis width={40} {...axisProps} />
            <Tooltip content={<ChartTooltip labelFormatter={l => fmtMonth(String(l))} formatter={v => `${Number(v).toLocaleString()} apps`} />} />
            <ReferenceLine x={`${p.projected_finish.slice(0, 7)}-01`} stroke="var(--success)" strokeDasharray="4 4" label={{ value: 'Projected finish', fill: 'var(--success)', fontSize: 11, position: 'insideTopRight' }} />
            <Area type="monotone" dataKey="target" name="Linear to target" stroke="var(--subtle-foreground)" strokeDasharray="4 4" fill="none" strokeWidth={1.5} isAnimationActive={false} />
            <Area type="monotone" dataKey="planned" name="Planned cutovers" stroke="var(--primary)" strokeWidth={2.2} fill="url(#burn)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </motion.div>
    </Card>
  )
}

function TierDonut() {
  const counts = useMemo(() => {
    const c: Record<Tier, number> = { GOLDEN: 0, GRAY: 0, RED: 0 }
    for (const a of fleet) c[a.tier]++
    return (['GOLDEN', 'GRAY', 'RED'] as Tier[]).map(t => ({ tier: t, name: TIER_LABEL[t], value: c[t], color: TIER_COLOR_VAR[t] }))
  }, [])
  const golden = counts[0].value
  return (
    <Card className="flex flex-col">
      <CardHeader title="Risk tiers" description="How much of the fleet flows untouched" />
      <motion.div initial={{ opacity: 0, scale: 0.92, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="relative mx-auto mt-2 h-52 w-full max-w-60">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<ChartTooltip formatter={v => `${Number(v).toLocaleString()} apps`} />} />
            <Pie data={counts} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="94%" paddingAngle={2.5} stroke="none" isAnimationActive={false}>
              {counts.map(c => <Cell key={c.tier} fill={c.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-3xl font-semibold tracking-tight"><CountUp value={Math.round((golden / fleet.length) * 100)} suffix="%" /></div>
          <div className="text-xs text-muted-foreground">Golden</div>
        </div>
      </motion.div>
      <div className="px-5 pb-5 pt-3"><Legend items={counts.map(c => ({ label: c.name, color: c.color, value: c.value.toLocaleString() }))} /></div>
    </Card>
  )
}

function Recommendations() {
  const { statuses, badWave, agents, cutovers, runBlueprint, runCutover } = useConsole()
  const { openCopilot } = useShell()
  const recs: { title: string; body: string; cta: React.ReactNode; tone: 'brand' | 'warning' | 'danger' | 'success' }[] = []
  const rolled = cutovers['app-orders']?.run.result === 'ROLLED_BACK'
  if (rolled) recs.push({ tone: 'danger', title: 'Fix app-orders and retry', body: 'Gate caught 500s from the target — UPSTREAM_URL was dropped. Re-run Blueprint with the input restored.', cta: <Link href="/blueprint?app=app-orders" className="text-xs font-medium text-primary">Open blueprint →</Link> })
  if (statuses['app-catalog'] === 'PLANNED') recs.push({ tone: 'brand', title: 'Apply the app-catalog blueprint', body: 'No upstream dependencies, 7 auto-fixable findings — the ideal first live migration.', cta: <button disabled={agents.blueprint === 'running'} onClick={() => runBlueprint('app-catalog', true)} className="text-xs font-medium text-primary disabled:opacity-50">Generate &amp; apply →</button> })
  if (statuses['app-catalog'] === 'PROVISIONED') recs.push({ tone: 'success', title: 'app-catalog is healthy on the target', body: 'Shift traffic 10 → 50 → 100% with health, error-rate, latency and share gates.', cta: <button onClick={() => runCutover('app-catalog')} className="text-xs font-medium text-primary">Start cutover →</button> })
  if (badWave) recs.push({ tone: 'warning', title: 'Bad-wave variant is armed', body: 'Wave 1 will ship app-orders without UPSTREAM_URL — expect an automatic rollback.', cta: <Link href="/cutover?app=app-orders" className="text-xs font-medium text-primary">Watch cutover →</Link> })
  recs.push({ tone: 'warning', title: `${fleet.filter(a => a.tier === 'GRAY').length} Gray apps need one approval`, body: 'Review generated diffs in batches by business unit to keep change management simple.', cta: <Link href="/fleet?tier=GRAY" className="text-xs font-medium text-primary">Review Gray apps →</Link> })
  recs.push({ tone: 'brand', title: 'Ask why anything is Red', body: 'Copilot explains each parked app from its tiering reasons — stateful data or licensing.', cta: <button onClick={() => openCopilot('Show red apps in Pharmacy')} className="text-xs font-medium text-primary">Ask Copilot →</button> })
  const dot = { brand: 'bg-primary', warning: 'bg-warning', danger: 'bg-destructive', success: 'bg-success' }
  return (
    <Card>
      <CardHeader icon={<Sparkles />} title="Recommended actions" description="Ranked from live pipeline state" />
      <ul className="flex flex-col gap-1 p-3">
        {recs.slice(0, 4).map(r => (
          <li key={r.title} className="flex gap-3 rounded-lg p-2.5 transition hover:bg-surface-2">
            <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', dot[r.tone])} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{r.title}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">{r.body}</p>
              <div className="mt-1.5">{r.cta}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function TopFindings() {
  const rows = useMemo(() => FINDING_CODES.map(c => ({ code: c as FindingCode, n: fleet.filter(a => a.findings.includes(c)).length })).sort((a, b) => b.n - a.n).slice(0, 6), [])
  const max = rows[0].n
  return (
    <Card>
      <CardHeader icon={<ShieldCheck />} title="Top findings" description="All auto-fixed by golden_app except STATEFUL" action={<Link href="/fleet" className="text-xs font-medium text-primary">Fleet →</Link>} />
      <ul className="flex flex-col gap-3 p-5 pt-4">
        {rows.map(r => (
          <li key={r.code}>
            <Link href={`/fleet?finding=${r.code}`} className="group block">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] text-muted-foreground group-hover:text-foreground">{r.code}</span>
                <span className="tabular font-medium">{r.n.toLocaleString()}</span>
              </div>
              <Progress value={(r.n / max) * 100} className="mt-1.5" tone={FINDING_META[r.code].severity === 'critical' ? 'danger' : 'brand'} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function OverviewView() {
  const { plan, statuses } = useConsole()
  const migrated = Object.values(statuses).filter(s => s === 'MIGRATED').length
  const golden = fleet.filter(a => a.tier === 'GOLDEN').length
  const p = plan.projection
  return (
    <>
      <PageHeader eyebrow="Mission control" title="Program overview" description="Real slice: 3 live apps across two AWS accounts. Synthetic scale: 1,000 apps through the same agents." />
      <Hero />
      <Reveal className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Apps discovered" value={fleet.length} icon={<Boxes />} hint="3 real · 1,000 synthetic" trend="up" trendLabel="+3 live" spark={[210, 380, 520, 610, 760, 880, 1003]} tip="Discovery scans Account A read-only via mig-discovery-readonly and ingests fleet.json through the same rules." />
        <StatCard label="Golden share" value={Math.round((golden / fleet.length) * 100)} suffix="%" icon={<CheckCircle2 />} hint={`${golden.toLocaleString()} apps need no human touch`} trend="up" trendLabel="target 60%" color="var(--golden)" spark={[48, 51, 55, 54, 58, 59, 60]} />
        <StatCard label="Projected finish" value={fmtLong(p.projected_finish)} icon={<CalendarCheck2 />} hint={`${plan.waves.length} waves · ${p.apps_per_day} apps / working day`} trend={p.meets_target_2027 ? 'up' : 'down'} trendLabel={p.meets_target_2027 ? 'meets 2027' : 'misses 2027'} />
        <StatCard label="Live apps migrated" value={`${migrated} / 3`} icon={<Rocket />} hint="Real traffic moved through the edge ALB" trend={migrated ? 'up' : 'flat'} trendLabel={migrated ? `${migrated} done` : 'pilot wave'} color="var(--target)" />
      </Reveal>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <RevealItem className="xl:col-span-2"><BurnUp /></RevealItem>
        <TierDonut />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Recommendations />
        <TopFindings />
        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader title="Live activity" description="Streaming from the event log" action={<Link href="/activity" className="text-xs font-medium text-primary">All events →</Link>} />
          <div className="p-3"><ActivityFeed limit={6} compact /></div>
        </Card>
      </div>
    </>
  )
}
