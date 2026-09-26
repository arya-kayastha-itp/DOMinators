'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Activity, AlertOctagon, Bomb, Bot, CheckCircle2, Circle, Gauge, HeartPulse, Loader2, Lock, Play, RotateCcw, Rocket, ShieldCheck, Split, Timer, XCircle } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { REAL_APP_IDS, fleetById } from '@/lib/data/fleet'
import { cn } from '@/lib/utils'
import { InfoTip, PageHeader, StatusBadge } from '@/components/console/bits'
import { ChartTooltip, Legend, axisProps, gridProps } from '@/components/console/charts'
import { useConsole, type CutoverState } from '@/components/console/console-provider'
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives'

function ParticleFlow({ targetPct, rolledBack }: { targetPct: number; rolledBack: boolean }) {
  const particles = 18
  return (
    <div className="relative h-24 overflow-hidden rounded-xl border bg-surface-2/50" aria-hidden>
      <div className="absolute inset-y-0 left-4 flex items-center gap-1.5 text-[11px] font-medium text-legacy"><span className="size-2 rounded-sm bg-legacy" />Legacy · Account A</div>
      <div className="absolute inset-y-0 right-4 flex items-center gap-1.5 text-[11px] font-medium text-target">Target · Account B<span className="size-2 rounded-sm bg-target" /></div>
      <div className="absolute inset-x-[18%] top-1/2 h-px bg-border-strong" />
      {Array.from({ length: particles }).map((_, i) => {
        const toTarget = (i * 37) % 100 < targetPct
        return (
          <motion.span
            key={`${i}-${toTarget}-${rolledBack}`}
            className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full"
            style={{ background: rolledBack ? 'var(--destructive)' : toTarget ? 'var(--target)' : 'var(--legacy)', boxShadow: `0 0 8px ${toTarget ? 'var(--target)' : 'transparent'}` }}
            initial={{ left: '50%', opacity: 0 }}
            animate={{ left: toTarget ? ['50%', '80%'] : ['50%', '20%'], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.6, delay: (i / particles) * 1.6, repeat: Infinity, ease: 'linear' }}
          />
        )
      })}
      <div className="absolute left-1/2 top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-elev-1"><Split className="size-4" /></div>
    </div>
  )
}

function Countdown({ c, windowMs }: { c: CutoverState; windowMs: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (c.phase !== 'observing') return; const iv = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(iv) }, [c.phase])
  const p = c.phase === 'observing' ? Math.min(1, (now - c.windowStart) / windowMs) : c.phase === 'done' ? 1 : 0
  const r = 18, circ = 2 * Math.PI * r
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 44 44" className="size-11 -rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--muted)" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - p)} />
      </svg>
      <div className="text-xs"><div className="font-medium">{c.phase === 'observing' ? `${Math.max(0, (windowMs - (now - c.windowStart)) / 1000).toFixed(1)} s` : c.phase === 'precheck' ? 'precheck' : c.phase === 'rolling_back' ? 'rolling back' : 'complete'}</div><div className="text-muted-foreground">observe window</div></div>
    </div>
  )
}

export function CutoverView() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const appId = (REAL_APP_IDS as readonly string[]).includes(params.get('app') ?? '') ? params.get('app')! : 'app-catalog'
  const { cutovers, blueprints, statuses, runCutover, runWave1, runBlueprint, badWave, setBadWave, agents, manualWeights, setManualWeight, healthCheck, observeWindowMs } = useConsole()
  const c = cutovers[appId]
  const bp = blueprints[appId]
  const provisioned = bp?.status === 'PROVISIONED'
  const running = !!c && c.phase !== 'done'
  const rolledBack = c?.run.result === 'ROLLED_BACK'
  const targetPct = c ? c.weight : manualWeights[appId] ?? 0
  const legacyPct = 100 - targetPct

  const last = useMemo(() => {
    const s = c?.series.slice(-8) ?? []
    if (!s.length) return null
    const avg = (k: 'error_rate' | 'target_share' | 'p95') => s.reduce((a, p) => a + p[k], 0) / s.length
    return { err: avg('error_rate'), share: avg('target_share'), p95: Math.max(...s.map(p => p.p95)) }
  }, [c?.series])

  const gates = [
    { key: 'health', icon: HeartPulse, label: 'Healthy targets', value: provisioned ? '1 / 1' : '0 / 1', limit: 'all healthy', pass: provisioned },
    { key: 'err', icon: AlertOctagon, label: 'Error rate', value: last ? `${last.err.toFixed(1)}%` : '—', limit: '≤ 2.0%', pass: last ? last.err <= 2 : null },
    { key: 'p95', icon: Timer, label: 'Latency p95', value: last ? `${Math.round(last.p95)} ms` : '—', limit: '≤ 800 ms', pass: last ? last.p95 <= 800 : null },
    { key: 'share', icon: Split, label: 'Target share', value: last ? `${Math.round(last.share)}%` : '—', limit: `≥ 80% of ${targetPct}%`, pass: last && targetPct ? !c?.run.rollback?.reason.startsWith('target share') : null },
  ]

  const select = (id: string) => router.replace(`${pathname}?app=${id}`, { scroll: false })

  return (
    <>
      <PageHeader
        eyebrow="Execute"
        title="Live cutover"
        description="Real traffic through the edge ALB's weighted target groups — no DNS caching. Gates are evaluated by code after every step; the LLM only explains afterwards."
        actions={<>
          <button onClick={() => setBadWave(!badWave)} aria-pressed={badWave} className={cn('inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition', badWave ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'bg-card hover:border-border-strong')}><Bomb className="size-4" />Bad wave {badWave ? 'armed' : 'off'}</button>
          <button onClick={() => { runWave1(); select('app-orders') }} disabled={agents.cutover === 'running' || agents.blueprint === 'running'} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-medium transition hover:border-border-strong disabled:opacity-50"><Play className="size-4" />Run wave 1</button>
          <button onClick={() => runCutover(appId)} disabled={running || !provisioned} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-elev-1 transition hover:brightness-110 disabled:opacity-50">{running ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}{running ? 'Cutting over…' : `Cut over ${appId}`}</button>
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Choose app">
        {REAL_APP_IDS.map(id => (
          <button key={id} role="radio" aria-checked={id === appId} onClick={() => select(id)} className={cn('inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] transition', id === appId ? 'border-primary/50 bg-primary/10 font-medium text-foreground' : 'bg-card text-muted-foreground hover:text-foreground')}>
            <span className="font-mono">{id}</span>{statuses[id] && <StatusBadge status={statuses[id]} />}
          </button>
        ))}
      </div>

      {!provisioned && !c ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck />}
            title={`${appId} has no healthy target yet`}
            description={`Precheck would abort: tg-${appId}-target is empty, so weights stay at legacy 100 / target 0. Apply the blueprint first — the orchestrator enforces this lifecycle.`}
            action={<div className="flex gap-2"><button onClick={() => runBlueprint(appId, true)} disabled={agents.blueprint === 'running'} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50">{agents.blueprint === 'running' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Apply blueprint</button><Link href={`/blueprint?app=${appId}`} className="inline-flex h-9 items-center rounded-lg border px-3 text-[13px] font-medium">View diff</Link></div>}
          />
        </Card>
      ) : (
        <>
          <Card className={cn('relative overflow-hidden transition-colors', rolledBack && 'border-destructive/40')}>
            <AnimatePresence>{c?.phase === 'rolling_back' && <motion.div initial={{ opacity: 0 }} animate={{ opacity: [0, 0.5, 0.15, 0.4, 0] }} exit={{ opacity: 0 }} transition={{ duration: 1.1 }} className="pointer-events-none absolute inset-0 bg-destructive/25" />}</AnimatePresence>
            <div className="relative grid grid-cols-1 gap-6 p-5 md:p-6 lg:grid-cols-[1fr_auto] lg:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {c ? <Badge tone={rolledBack ? 'danger' : c.run.result === 'MIGRATED' ? 'success' : 'brand'}>{c.run.run_id}</Badge> : <Badge tone="neutral">no run yet</Badge>}
                  <span className="font-mono">{fleetById.get(appId)!.name}</span>
                  <span>· listener rule {`/${appId.replace('app-', '')}`}</span>
                </div>
                <div className="mt-3 flex items-end gap-6">
                  <div><div className="text-xs text-muted-foreground">Legacy</div><div className="text-4xl font-semibold tracking-tight text-legacy tabular md:text-5xl">{legacyPct}<span className="text-2xl">%</span></div></div>
                  <div className="pb-2 text-subtle">/</div>
                  <div><div className="text-xs text-muted-foreground">Target</div><div className="text-4xl font-semibold tracking-tight text-target tabular md:text-5xl">{targetPct}<span className="text-2xl">%</span></div></div>
                </div>
                <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Traffic split: legacy ${legacyPct}%, target ${targetPct}%`}>
                  <motion.div className="h-full bg-legacy" animate={{ width: `${legacyPct}%` }} transition={{ duration: 0.35 }} />
                  <motion.div className="h-full bg-target" animate={{ width: `${targetPct}%` }} transition={{ duration: 0.35 }} />
                </div>
              </div>
              <div className="flex flex-col items-start gap-4 lg:items-end">
                {c && <Countdown c={c} windowMs={observeWindowMs} />}
                <ol className="flex items-center gap-1.5" aria-label="Cutover steps">
                  {[10, 50, 100].map((w, i) => {
                    const h = c?.run.history[i]
                    const current = c && c.stepIdx === i && c.phase === 'observing'
                    return (
                      <li key={w} className="flex items-center gap-1.5">
                        <span className={cn('flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium tabular', h?.gate === 'PASS' && 'border-success/30 bg-success/10 text-success', h?.gate === 'FAIL' && 'border-destructive/40 bg-destructive/10 text-destructive', current && 'border-primary/40 bg-primary/10 text-primary')}>
                          {h?.gate === 'PASS' ? <CheckCircle2 className="size-3.5" /> : h?.gate === 'FAIL' ? <XCircle className="size-3.5" /> : current ? <Loader2 className="size-3.5 animate-spin" /> : <Circle className="size-3.5 text-subtle" />}{w}%
                        </span>
                        {i < 2 && <span className="h-px w-3 bg-border-strong" />}
                      </li>
                    )
                  })}
                </ol>
              </div>
            </div>
            <div className="relative px-5 pb-5 md:px-6"><ParticleFlow targetPct={targetPct} rolledBack={c?.phase === 'rolling_back'} /></div>
          </Card>

          <AnimatePresence>
            {rolledBack && c.run.rollback && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="mt-4 overflow-hidden rounded-xl border border-destructive/40 bg-destructive/5">
                <div className="flex items-start gap-3 p-4 md:p-5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive"><RotateCcw className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">Rolled back automatically at {c.run.rollback.at_weight}% — no human involved</div>
                    <div className="mt-1 text-[13px] text-muted-foreground">Gate: <span className="font-mono text-destructive">{c.run.rollback.reason}</span> · weights restored to legacy 100 / target 0 in <span className="font-medium text-foreground">{((c.restoreMs ?? 0) / 1000).toFixed(1)} s</span> · target instance kept for debugging</div>
                    <div className="mt-3 rounded-lg border bg-card p-3 text-[13px]">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary"><Bot className="size-3.5" />Explanation · Claude (after the decision)</div>
                      {c.run.explanation ? <p className="leading-relaxed text-muted-foreground">{c.run.explanation}</p> : <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Summarising metrics and recent events…</p>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={`/blueprint?app=${appId}`} onClick={() => setBadWave(false)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">Fix &amp; retry in Blueprint</Link>
                      <Link href="/activity" className="inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium">Audit trail</Link>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {gates.map(g => (
              <Card key={g.key} className={cn('relative p-4 transition-colors', g.pass === false && 'border-destructive/40 bg-destructive/5', g.pass === true && 'border-success/25')}>
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><g.icon className="size-3.5" />{g.label}
                  <span className={cn('ml-auto size-2 rounded-full', g.pass === null ? 'bg-border-strong' : g.pass ? 'bg-success' : 'bg-destructive')} />
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-tight tabular">{g.value}</div>
                <div className="mt-0.5 text-[11px] text-subtle">threshold {g.limit}</div>
              </Card>
            ))}
          </div>

          <Card className="mt-4">
            <CardHeader icon={<Activity />} title="Live traffic" description="~20 req/s to the edge ALB · target share and error rate per 250 ms tick" action={<Legend items={[{ label: 'Target share %', color: 'var(--target)' }, { label: 'Weight %', color: 'var(--subtle-foreground)' }, { label: 'Error rate %', color: 'var(--destructive)' }]} />} />
            <div className="h-72 px-2 pb-3 pt-4">
              {c && c.series.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={c.series} margin={{ left: 0, right: 8 }}>
                    <defs><linearGradient id="share" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--target)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--target)" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={t => `${Math.round(t)}s`} {...axisProps} />
                    <YAxis domain={[0, 100]} width={36} tickFormatter={v => `${v}%`} {...axisProps} />
                    <Tooltip content={<ChartTooltip labelFormatter={t => `t + ${Number(t).toFixed(1)} s`} formatter={v => `${Number(v).toFixed(0)}%`} />} />
                    <Area type="monotone" dataKey="target_share" name="Target share" stroke="var(--target)" strokeWidth={2} fill="url(#share)" isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="weight" name="Weight" stroke="var(--subtle-foreground)" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="error_rate" name="Error rate" stroke="var(--destructive)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState icon={<Gauge />} title="Waiting for traffic" description={`Start a cutover to stream samples. ${provisioned ? `${appId} is healthy on the target and ready.` : ''}`} />
              )}
            </div>
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader icon={<Lock />} title="Guardrails" description="Why this is safe to run unattended" />
              <ul className="flex flex-col gap-2.5 p-5 pt-4 text-[13px] text-muted-foreground">
                <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />Rollback is deterministic code — one <code className="font-mono text-xs">modify_rule</code> call back to 100/0, in a <code className="font-mono text-xs">finally</code> path.</li>
                <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />A heartbeat watchdog resets weights if the cutover process is hard-killed.</li>
                <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />Mutations only touch resources tagged <code className="font-mono text-xs">managed-by=migration-accelerator</code>.</li>
                <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />Claude writes the explanation after the decision — it never triggers a rollback.</li>
              </ul>
            </Card>
            <Card>
              <CardHeader title="Break-glass controls" description="Operator overrides — logged as WEIGHT_SET (manual)" action={<InfoTip>Disabled while an automated cutover is running, so a human can&apos;t race the controller.</InfoTip>} />
              <div className="flex flex-wrap gap-2 p-5 pt-4">
                {[0, 50, 100].map(w => (
                  <button key={w} disabled={running || (!provisioned && w > 0)} onClick={() => setManualWeight(appId, w)} className={cn('inline-flex h-9 items-center rounded-lg border px-3 font-mono text-[13px] transition hover:border-border-strong disabled:opacity-40', targetPct === w && !c && 'border-primary/50 bg-primary/10')}>
                    {100 - w} / {w}
                  </button>
                ))}
                <button onClick={() => healthCheck(appId)} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition hover:border-border-strong"><HeartPulse className="size-4" />Run health check</button>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  )
}
