'use client'

import { LayoutGroup, motion } from 'framer-motion'
import { AlertOctagon, ArrowRight, Boxes, CalendarCheck2, CheckCircle2, CircleDashed, Layers3, Loader2, Lock, Play, Radar, Rocket, ShieldCheck, Sparkles, Target, Wrench, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AgentName, AppStatus, FindingCode, Tier } from '@/lib/contracts'
import { cutoverLive } from '@/lib/live'
import { FINDING_META, TARGET_DATE } from '@/lib/meta'
import { cn } from '@/lib/utils'
import { PageHeader, Reveal, RevealItem, StatCard, TIER_COLOR_VAR, TIER_LABEL, stagger } from '@/components/console/bits'
import { ChartTooltip, Legend, axisProps, gridProps } from '@/components/console/charts'
import { useConsole, type AgentState } from '@/components/console/console-provider'
import { useShell } from '@/components/shell/app-shell'
import { Badge, Card, CardHeader, CountUp, EmptyState, Progress, Tip } from '@/components/ui/primitives'
import { ActivityFeed } from './activity'

const fmtMonth = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const fmtLong = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const stateIcon = (s: AgentState) => s === 'running' ? <Loader2 className="size-3.5 animate-spin text-primary" /> : s === 'done' ? <CheckCircle2 className="size-3.5 text-success" /> : s === 'error' ? <XCircle className="size-3.5 text-destructive" /> : <CircleDashed className="size-3.5 text-subtle" />

// ---------------------------------------------------------------- next step (guided demo)
type Step = { title: string; body: string; cta: string; icon: React.ReactNode; run?: () => void; href: string; disabled?: boolean }

function useNextStep(): Step | null {
  const c = useConsole()
  const { online, summary, plan, statuses, demo, isRunning } = c
  if (!online || !demo) return null
  if (demo.running.length) return { title: 'Agents at work', body: `Running now: ${demo.running.join(', ')}. Watch it live — every card below moves on real events.`, cta: 'Open activity', icon: <Loader2 className="size-4 animate-spin" />, href: '/activity' }
  if (!summary?.discovered) return { title: 'Discover the legacy estate', body: 'Scan Account A read-only (EC2, SGs, EBS, SSM) and tier every app — plus the synthetic fleet (data/fleet.json) through the same rules.', cta: 'Run discovery', icon: <Radar className="size-4" />, run: c.runDiscovery, href: '/fleet' }
  if (!plan) return { title: 'Build the wave plan', body: 'Park the Red apps, order providers before consumers and pack waves at the chosen capacity.', cta: 'Build wave plan', icon: <Layers3 className="size-4" />, run: () => c.runPlanning(), href: '/plan' }
  const wave0 = summary.plan?.wave0 ?? []
  const caps = demo.capabilities
  const rolled = wave0.find(id => statuses[id] === 'ROLLED_BACK' || statuses[id] === 'FAILED')
  if (rolled && caps[rolled]?.provision) return { title: `${rolled} rolled back — fix and retry`, body: 'The gate caught a bad target and put traffic back on legacy. Disarm the bad wave and re-apply with -replace.', cta: 'Fix & retry', icon: <Wrench className="size-4" />, run: async () => { if (demo.bad_wave[rolled]) await c.setBadWave(false, rolled); c.runRetry(rolled) }, href: `/blueprint?app=${rolled}`, disabled: isRunning(rolled) }
  const toCut = wave0.find(id => caps[id]?.cutover && statuses[id] === 'PROVISIONED')
  if (toCut) return { title: `Cut ${toCut} over`, body: `Its golden instance is healthy in Account B. Shift real ALB traffic ${(demo.cutover_config.steps ?? []).join(' → ')}% with gates after every step.`, cta: `Cut over ${toCut}`, icon: <Rocket className="size-4" />, run: () => c.runCutover(toCut), href: `/cutover?app=${toCut}` }
  const toApply = wave0.find(id => caps[id]?.provision && ['PLANNED', 'BLUEPRINTED', 'FAILED'].includes(statuses[id] ?? ''))
  if (toApply) return { title: `Provision ${toApply} on the golden pattern`, body: 'Render golden_app Terraform with every finding fixed and run a real terraform apply into Account B — streamed live.', cta: `Apply ${toApply}`, icon: <ShieldCheck className="size-4" />, run: () => c.runBlueprint(toApply, true), href: `/blueprint?app=${toApply}` }
  const nextWave = plan.waves.find(w => w.wave > 0 && w.app_ids.some(id => !['MIGRATED', 'ROLLED_BACK'].includes(statuses[id] ?? '')))
  if (nextWave) return { title: `Run wave ${nextWave.wave} at scale`, body: `${nextWave.app_ids.length} inventory apps: blueprints and cutovers at fleet scale, through the same pipeline the pilot apps just went through.`, cta: `Run wave ${nextWave.wave}`, icon: <Play className="size-4" />, run: () => c.runWave(nextWave.wave), href: '/plan' }
  return { title: 'Every wave has run', body: 'Reset the demo to run it again from a clean legacy baseline.', cta: 'Open plan', icon: <CheckCircle2 className="size-4" />, href: '/plan' }
}

function Hero() {
  const { summary, plan, agents, demo, online, blueprints, statuses } = useConsole()
  const { openCopilot } = useShell()
  const step = useNextStep()
  const s = summary
  const provisioned = Object.values(blueprints).filter(b => b.status === 'PROVISIONED').length
  const capable = Object.entries(demo?.capabilities ?? {}).filter(([, v]) => v.cutover).map(([k]) => k)
  const migratedReal = capable.filter(id => statuses[id] === 'MIGRATED').length
  const STEPS: { key: AgentName; label: string; icon: React.ComponentType<{ className?: string }>; href: string; detail: string }[] = [
    { key: 'discovery', label: 'Discover', icon: Radar, href: '/fleet', detail: s?.discovered ? `${s.apps_total.toLocaleString()} apps · ${s.findings_real_total} findings on ${s.real} real` : 'not run yet' },
    { key: 'planning', label: 'Plan', icon: Layers3, href: '/plan', detail: plan ? `${plan.waves.length} waves · finish ${fmtLong(plan.projection.projected_finish)}` : 'not run yet' },
    { key: 'blueprint', label: 'Blueprint', icon: ShieldCheck, href: '/blueprint', detail: `${Object.keys(blueprints).length} real blueprints · ${provisioned} provisioned` },
    { key: 'cutover', label: 'Cut over', icon: Rocket, href: '/cutover', detail: `${migratedReal} / ${capable.length} live-capable real apps migrated` },
  ]
  return (
    <Card className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-brand-2/15 blur-3xl" />
      <div className="relative grid grid-cols-1 gap-8 p-6 md:p-8 xl:grid-cols-[1.1fr_1fr] xl:items-center">
        <div>
          <Badge tone="brand"><Sparkles className="size-3" /> Agentic migration · rules decide{demo?.llm?.backend && demo.llm.backend !== 'off' ? `, ${demo.llm.model ?? demo.llm.backend} explains` : ''}</Badge>
          <h2 className="mt-4 text-3xl font-semibold leading-[1.1] tracking-tight md:text-[40px]">
            {s?.discovered ? <>{s.apps_total.toLocaleString()} apps.<br /><span className="text-gradient">Four agents. Real traffic.</span></> : <>Point four agents<br /><span className="text-gradient">at a legacy AWS estate.</span></>}
          </h2>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Discover → plan → rebuild on a hardened golden pattern → shift live ALB traffic with gates and automatic rollback. {s?.discovered ? `${s.real} real apps run in Account A; ${s.synthetic.toLocaleString()} synthetic apps go through the same agents.` : ''}
          </p>
          {step ? (
            <div className="glass mt-6 max-w-xl rounded-xl border p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary"><span className="live-dot size-1.5" />Next step</div>
              <div className="mt-1.5 text-[15px] font-semibold">{step.title}</div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{step.body}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {step.run && <button onClick={step.run} disabled={step.disabled} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-elev-2 transition hover:brightness-110 disabled:opacity-60">{step.icon}{step.cta}</button>}
                <Link href={step.href} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-card px-4 text-sm font-medium transition hover:border-border-strong">{step.run ? 'Watch it' : step.cta} <ArrowRight className="size-4" /></Link>
                <button onClick={() => openCopilot('Summarise fleet risk by tier')} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition hover:text-foreground"><Sparkles className="size-4 text-primary" /> Ask Copilot</button>
              </div>
            </div>
          ) : !online && (
            <div className="mt-6 max-w-xl rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-[13px]"><span className="font-medium">Orchestrator offline.</span> <span className="text-muted-foreground">Start it with <code className="font-mono">uvicorn orchestrator.main:app --port 8000</code>.</span></div>
          )}
        </div>
        <motion.ol initial="hidden" animate="show" variants={stagger} className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Agent pipeline">
          {STEPS.map((st, i) => (
            <motion.li key={st.key} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
              <Link href={st.href} className={cn('glass group flex items-start gap-3 rounded-xl border p-3.5 transition hover:border-border-strong hover:shadow-elev-2', agents[st.key] === 'running' && 'border-primary/40 glow-brand', agents[st.key] === 'error' && 'border-destructive/40')}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"><st.icon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold"><span className="font-mono text-[11px] text-subtle">0{i + 1}</span>{st.label}<span className="ml-auto">{stateIcon(agents[st.key])}</span></span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{st.detail}</span>
                </span>
              </Link>
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- the migration board
const LANES: { key: string; label: string; statuses: AppStatus[]; tone: string }[] = [
  { key: 'discovered', label: 'Discovered', statuses: ['DISCOVERED', 'TIERED'], tone: 'var(--muted-foreground)' },
  { key: 'planned', label: 'Planned', statuses: ['PLANNED'], tone: 'var(--info)' },
  { key: 'blueprinted', label: 'Blueprinted', statuses: ['BLUEPRINTED'], tone: 'var(--primary)' },
  { key: 'provisioned', label: 'Provisioned', statuses: ['PROVISIONED'], tone: 'var(--target)' },
  { key: 'cutting', label: 'Cutting over', statuses: ['CUTTING_OVER'], tone: 'var(--warning)' },
  { key: 'migrated', label: 'Migrated', statuses: ['MIGRATED'], tone: 'var(--success)' },
]
const SIDE: { key: string; label: string; statuses: AppStatus[]; icon: React.ReactNode; tone: string }[] = [
  { key: 'parked', label: 'Parked (Red)', statuses: ['PARKED'], icon: <Lock className="size-3.5" />, tone: 'var(--red-tier)' },
  { key: 'attention', label: 'Rolled back / failed', statuses: ['ROLLED_BACK', 'FAILED'], icon: <AlertOctagon className="size-3.5" />, tone: 'var(--destructive)' },
]

function AppCard({ id }: { id: string }) {
  const { fleetById, statuses, events, isRunning, demo } = useConsole()
  const a = fleetById.get(id)
  const status = statuses[id]
  const running = isRunning(id)
  const live = status === 'CUTTING_OVER' ? cutoverLive(events, id, demo?.cutover_config?.steps) : null
  const href = status === 'PROVISIONED' || status === 'CUTTING_OVER' || status === 'MIGRATED' || status === 'ROLLED_BACK' ? `/cutover?app=${id}` : `/blueprint?app=${id}`
  return (
    <motion.div layout layoutId={`card-${id}`} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
      <Link href={href} className={cn('group relative block overflow-hidden rounded-lg border bg-card px-2.5 py-2 text-left shadow-elev-1 transition hover:border-border-strong', running && 'border-primary/50 glow-brand', status === 'MIGRATED' && 'border-success/40', status === 'ROLLED_BACK' && 'border-destructive/40')}>
        {running && <span className="pointer-events-none absolute inset-0 animate-[sweep_1.6s_linear_infinite] bg-gradient-to-r from-transparent via-primary/10 to-transparent" />}
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: a ? TIER_COLOR_VAR[a.tier] : 'var(--border-strong)' }} />
          <span className="truncate font-mono text-[11.5px] font-medium">{id.replace('app-', '')}</span>
          {running && <Loader2 className="ml-auto size-3 shrink-0 animate-spin text-primary" />}
        </div>
        {live && (
          <div className="mt-1.5">
            <div className="flex h-1 overflow-hidden rounded-full bg-muted"><motion.div className="h-full bg-target" animate={{ width: `${live.weight}%` }} /></div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{100 - live.weight}/{live.weight} · {live.phase === 'observing' ? 'gating' : live.phase}</div>
          </div>
        )}
      </Link>
    </motion.div>
  )
}

function MigrationBoard() {
  const { realAppIds, statuses, summary, online } = useConsole()
  const synth = summary?.statuses_synthetic ?? {}
  const count = (sts: AppStatus[]) => sts.reduce((n, s) => n + (synth[s] ?? 0), 0)
  const reals = (sts: AppStatus[]) => realAppIds.filter(id => sts.includes(statuses[id]))
  const total = summary?.synthetic ?? 0
  return (
    <Card className="relative overflow-hidden">
      <CardHeader icon={<Boxes />} title="Migration board" description="Every real app is a card that moves on real lifecycle events. The number in each lane is how many of the synthetic apps are there right now." action={<Badge tone={online ? 'success' : 'danger'}><span className="live-dot size-1.5" />{online ? 'live' : 'offline'}</Badge>} />
      {!summary?.discovered ? (
        <EmptyState icon={<Radar />} title="Nothing discovered yet" description="Run discovery and the six real apps plus the synthetic fleet land in the first lane." />
      ) : (
        <LayoutGroup>
          <div className="scrollbar-thin overflow-x-auto px-5 pb-5 pt-4">
            <div className="grid min-w-[860px] grid-cols-6 gap-2">
              {LANES.map((l, i) => {
                const n = count(l.statuses)
                return (
                  <div key={l.key} className="relative flex min-h-44 flex-col rounded-xl border bg-surface-2/40 p-2">
                    {i < LANES.length - 1 && <span className="pointer-events-none absolute -right-2 top-7 z-10 h-px w-2 bg-border-strong" />}
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: l.tone }}>{l.label}</span>
                    </div>
                    <div className="px-1 pt-1">
                      <div className="text-2xl font-semibold tracking-tight tabular"><CountUp value={n} /></div>
                      <div className="text-[10.5px] text-muted-foreground">synthetic{total ? ` · ${Math.round((n / total) * 100)}%` : ''}</div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"><motion.div className="h-full rounded-full" style={{ background: l.tone }} initial={false} animate={{ width: `${total ? (n / total) * 100 : 0}%` }} /></div>
                    </div>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {reals(l.statuses).map(id => <AppCard key={id} id={id} />)}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-2 grid min-w-[860px] grid-cols-2 gap-2">
              {SIDE.map(l => (
                <div key={l.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-2">
                  <span className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: l.tone }}>{l.icon}{l.label}</span>
                  <Tip content="Synthetic apps in this state"><span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] tabular">{count(l.statuses).toLocaleString()}</span></Tip>
                  <div className="flex flex-wrap gap-1.5">{reals(l.statuses).map(id => <div key={id} className="w-36"><AppCard id={id} /></div>)}</div>
                </div>
              ))}
            </div>
          </div>
        </LayoutGroup>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- charts
function BurnUp() {
  const { plan } = useConsole()
  const data = useMemo(() => {
    if (!plan?.waves.length) return []
    const byMonth = new Map<string, number>()
    let cum = 0
    for (const w of plan.waves) { cum += w.app_ids.length; byMonth.set(w.start.slice(0, 7), cum) }
    const total = plan.projection.apps_schedulable
    const start = new Date(`${plan.waves[0].start.slice(0, 7)}-01T00:00:00Z`)
    const end = new Date(`${TARGET_DATE}T00:00:00Z`)
    const out: { month: string; planned: number; target: number }[] = []
    let last = 0
    for (const d = new Date(start); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const key = d.toISOString().slice(0, 7)
      if (byMonth.has(key)) last = byMonth.get(key)!
      const frac = (d.getTime() - start.getTime()) / (end.getTime() - start.getTime())
      out.push({ month: `${key}-01`, planned: last, target: Math.round(total * frac) })
    }
    return out
  }, [plan])
  if (!plan) return <Card className="flex h-full flex-col"><CardHeader title="Migration burn-up" description="Cumulative apps per the committed wave plan" /><EmptyState icon={<Layers3 />} title="No plan yet" description="Build the wave plan to project the finish date." /></Card>
  const p = plan.projection
  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Migration burn-up"
        description={`Cumulative apps per the committed plan vs. a straight line to the ${fmtLong(TARGET_DATE)} program target`}
        action={<Badge tone={p.meets_target_2027 ? 'success' : 'danger'}><Target className="size-3" />{p.meets_target_2027 ? 'Meets the 2027 target' : 'Misses the 2027 target'}</Badge>}
      />
      <div className="h-64 px-2 pb-2 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
            <defs><linearGradient id="burn" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="month" tickFormatter={fmtMonth} minTickGap={28} {...axisProps} />
            <YAxis width={40} {...axisProps} />
            <Tooltip content={<ChartTooltip labelFormatter={l => fmtMonth(String(l))} formatter={v => `${Number(v).toLocaleString()} apps`} />} />
            <ReferenceLine x={`${p.projected_finish.slice(0, 7)}-01`} stroke="var(--success)" strokeDasharray="4 4" label={{ value: 'Projected finish', fill: 'var(--success)', fontSize: 11, position: 'insideTopRight' }} />
            <Area type="monotone" dataKey="target" name="Linear to target" stroke="var(--subtle-foreground)" strokeDasharray="4 4" fill="none" strokeWidth={1.5} isAnimationActive={false} />
            <Area type="monotone" dataKey="planned" name="Planned cutovers" stroke="var(--primary)" strokeWidth={2.2} fill="url(#burn)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function TierDonut() {
  const { summary } = useConsole()
  const counts = (['GOLDEN', 'GRAY', 'RED'] as Tier[]).map(t => ({ tier: t, name: TIER_LABEL[t], value: summary?.tiers?.[t] ?? 0, color: TIER_COLOR_VAR[t] }))
  const total = summary?.apps_total ?? 0
  return (
    <Card className="flex flex-col">
      <CardHeader title="Risk tiers" description={summary?.llm_decisions ? `${summary.llm_decisions} borderline calls made by the LLM, the rest by rules` : 'Decided by rules'} />
      {total ? (
        <>
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
              <div className="text-3xl font-semibold tracking-tight"><CountUp value={Math.round((counts[0].value / total) * 100)} suffix="%" /></div>
              <div className="text-xs text-muted-foreground">Golden</div>
            </div>
          </motion.div>
          <div className="px-5 pb-5 pt-3"><Legend items={counts.map(c => ({ label: c.name, color: c.color, value: c.value.toLocaleString() }))} /></div>
        </>
      ) : <EmptyState icon={<CircleDashed />} title="No tiers yet" description="Discovery tiers every app." />}
    </Card>
  )
}

function TopFindings() {
  const { summary } = useConsole()
  const rows = Object.entries(summary?.findings ?? {}).map(([code, n]) => ({ code: code as FindingCode, n })).sort((a, b) => b.n - a.n).slice(0, 6)
  const max = rows[0]?.n ?? 1
  return (
    <Card>
      <CardHeader icon={<ShieldCheck />} title="Top findings" description="All auto-fixed by golden_app except STATEFUL" action={<Link href="/fleet" className="text-xs font-medium text-primary">Fleet →</Link>} />
      {rows.length ? (
        <ul className="flex flex-col gap-3 p-5 pt-4">
          {rows.map(r => (
            <li key={r.code}>
              <Link href={`/fleet?finding=${r.code}`} className="group block">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-[11px] text-muted-foreground group-hover:text-foreground">{r.code}</span>
                  <span className="tabular font-medium">{r.n.toLocaleString()}</span>
                </div>
                <Progress value={(r.n / max) * 100} className="mt-1.5" tone={FINDING_META[r.code]?.severity === 'critical' ? 'danger' : 'brand'} />
              </Link>
            </li>
          ))}
        </ul>
      ) : <EmptyState icon={<ShieldCheck />} title="No findings yet" description="Run discovery." />}
    </Card>
  )
}

export function OverviewView() {
  const { summary, plan, statuses, demo } = useConsole()
  const s = summary
  const capable = Object.entries(demo?.capabilities ?? {}).filter(([, v]) => v.cutover).map(([k]) => k)
  const migrated = capable.filter(id => statuses[id] === 'MIGRATED').length
  const golden = s?.tiers?.GOLDEN ?? 0
  const p = plan?.projection
  return (
    <>
      <PageHeader eyebrow="Mission control" title="Program overview" description={s?.discovered ? `Real slice: ${s.real} apps in Account A, ${s.edges_real} real dependency edges. Synthetic scale: ${s.synthetic.toLocaleString()} apps through the same agents.` : 'Real legacy apps in Account A plus a synthetic fleet, through the same four agents.'} />
      <Hero />
      <RevealItem className="mt-4"><MigrationBoard /></RevealItem>
      <Reveal className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Apps discovered" value={s?.apps_total ?? 0} icon={<Boxes />} hint={s?.discovered ? `${s.real} real · ${s.synthetic.toLocaleString()} synthetic${s.last_discovery ? ` · scan ${(s.last_discovery.duration_ms / 1000).toFixed(1)} s` : ''}` : 'run discovery'} tip="Discovery scans Account A read-only (only the legacy VPC) and ingests data/fleet.json through the same rules." />
        <StatCard label="Golden share" value={s?.apps_total ? Math.round((golden / s.apps_total) * 100) : 0} suffix="%" icon={<CheckCircle2 />} hint={`${golden.toLocaleString()} apps need no human touch`} color="var(--golden)" />
        <StatCard label="Projected finish" value={p ? fmtLong(p.projected_finish) : '—'} icon={<CalendarCheck2 />} hint={plan ? `${plan.waves.length} waves at ${plan.capacity_per_wave}/wave · ${p!.apps_per_day} apps / day` : 'build the wave plan'} trend={p ? (p.meets_target_2027 ? 'up' : 'down') : undefined} trendLabel={p ? (p.meets_target_2027 ? 'meets 2027' : 'misses 2027') : undefined} />
        <StatCard label="Real apps migrated" value={`${migrated} / ${capable.length}`} icon={<Rocket />} hint="Live ALB traffic moved to the golden target" trend={migrated ? 'up' : 'flat'} trendLabel={migrated ? `${migrated} done` : 'pilot wave'} color="var(--target)" />
      </Reveal>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <RevealItem className="xl:col-span-2"><BurnUp /></RevealItem>
        <TierDonut />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopFindings />
        <Card>
          <CardHeader title="Live activity" description="Streaming from the orchestrator's event log" action={<Link href="/activity" className="text-xs font-medium text-primary">All events →</Link>} />
          <div className="p-3"><ActivityFeed limit={8} compact /></div>
        </Card>
      </div>
    </>
  )
}
