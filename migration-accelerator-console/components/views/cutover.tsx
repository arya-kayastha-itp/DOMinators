'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Activity, AlertOctagon, Bomb, Bot, CheckCircle2, Circle, Gauge, HeartPulse, Loader2, Lock, Play, Radio, RotateCcw, Rocket, ShieldCheck, Split, Timer, Wrench, XCircle } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type LiveWeights, type TrafficBucket } from '@/lib/api'
import { cutoverLive } from '@/lib/live'
import { cn } from '@/lib/utils'
import { InfoTip, PageHeader, StatusBadge } from '@/components/console/bits'
import { ChartTooltip, Legend, axisProps, gridProps } from '@/components/console/charts'
import { useConsole } from '@/components/console/console-provider'
import { TrafficFlow } from '@/components/console/traffic-flow'
import { Badge, Card, CardHeader, EmptyState, Tip } from '@/components/ui/primitives'

const pct = (x: number | undefined | null, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`)
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (!active) return; const iv = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(iv) }, [active])
  return now
}

function Countdown({ windowStart, windowS, settleS, label }: { windowStart: number | null; windowS: number; settleS: number; label: string }) {
  const now = useNow(windowStart != null)
  const elapsed = windowStart ? (now - windowStart) / 1000 : 0
  const p = windowStart ? Math.min(1, elapsed / windowS) : 0
  const settling = windowStart != null && elapsed < settleS
  const r = 20, circ = 2 * Math.PI * r
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 48 48" className="size-12 -rotate-90" aria-hidden>
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--muted)" strokeWidth="4" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={settling ? 'var(--warning)' : 'var(--primary)'} strokeWidth="4" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - p)} />
      </svg>
      <div className="text-xs">
        <div className="font-mono text-sm font-semibold tabular">{windowStart ? `${Math.max(0, windowS - elapsed).toFixed(1)} s` : label}</div>
        <div className="text-muted-foreground">{windowStart ? (settling ? `settling (${settleS}s — ALB weight propagation)` : 'observe window · gates evaluating') : 'observe window'}</div>
      </div>
    </div>
  )
}

export function CutoverView() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { fleetById, realAppIds, statuses, events, demo, cutovers, runCutover, runBlueprint, runRetry, runWave, setBadWave, setManualWeight, isRunning, online, summary } = useConsole()

  const cutoverable = realAppIds.filter(id => demo?.capabilities?.[id]?.provision)
  const requested = params.get('app') ?? ''
  const appId = realAppIds.includes(requested) ? requested : (cutoverable[0] ?? realAppIds[0] ?? 'app-catalog')
  const app = fleetById.get(appId)
  const cap = demo?.capabilities?.[appId]
  const cfg = demo?.cutover_config
  const status = statuses[appId]
  const live = useMemo(() => cutoverLive(events, appId, cfg?.steps ?? [10, 50, 100]), [events, appId, cfg?.steps])
  const run = cutovers[appId]
  const busy = isRunning(appId)
  const inFlight = live.phase === 'warmup' || live.phase === 'observing'
  const badWaveOn = !!demo?.bad_wave?.[appId]

  // ---- real traffic (1 s while a run is live, 10 s otherwise) and live ALB weights
  const [buckets, setBuckets] = useState<TrafficBucket[]>([])
  const [alb, setAlb] = useState<LiveWeights | null>(null)
  const [albErr, setAlbErr] = useState<string | null>(null)
  const recent = live.endedAt != null && Date.now() - live.endedAt < 30000
  useEffect(() => {
    let stop = false
    const tick = async () => { try { const b = await api.traffic(appId, 240); if (!stop) setBuckets(b) } catch { /* offline */ } }
    tick()
    const iv = setInterval(tick, busy || inFlight || recent ? 1000 : 10000)
    return () => { stop = true; clearInterval(iv) }
  }, [appId, busy, inFlight, recent])
  useEffect(() => {
    if (!cap?.provision) { setAlb(null); return }
    let stop = false
    const tick = async () => { try { const w = await api.weights(appId); if (!stop) { setAlb(w); setAlbErr(null) } } catch (e) { if (!stop) setAlbErr(e instanceof Error ? e.message : String(e)) } }
    tick()
    const iv = setInterval(tick, busy || inFlight ? 2000 : 8000)
    return () => { stop = true; clearInterval(iv) }
  }, [appId, cap?.provision, busy, inFlight])

  const targetPct = alb?.target ?? live.weight
  const legacyPct = alb ? (alb.legacy ?? 100 - targetPct) : 100 - targetPct

  // ---- chart series from real buckets
  const series = useMemo(() => {
    if (!buckets.length) return []
    const t0 = buckets[0].t
    const wAt = (t: number) => { let w = 0; for (const x of live.weightTimeline) if (x.t / 1000 <= t) w = x.weight; return w }
    return buckets.map(b => {
      const served = b.target + b.legacy
      return { t: b.t - t0, share: served ? (b.target / served) * 100 : null, weight: wAt(b.t), err: b.n ? (b.errors / b.n) * 100 : 0, p95: b.p95_ms, n: b.n }
    })
  }, [buckets, live.weightTimeline])

  // ---- live gate readings over the current window (after settle), thresholds from config.yaml
  const gateNow = useMemo(() => {
    if (!cfg) return null
    const from = live.windowStart ? live.windowStart / 1000 + cfg.settle_s : Date.now() / 1000 - 15
    const win = buckets.filter(b => b.t >= from)
    const n = win.reduce((a, b) => a + b.n, 0)
    if (!n) return null
    const served = win.reduce((a, b) => a + b.target + b.legacy, 0)
    const errors = win.reduce((a, b) => a + b.errors, 0)
    const p95 = Math.max(...win.map(b => b.p95_ms ?? 0))
    return { n, err: errors / n, share: served ? win.reduce((a, b) => a + b.target, 0) / served : 0, p95 }
  }, [buckets, cfg, live.windowStart])

  const g = cfg?.gates
  const expected = live.weight / 100
  const gates = [
    { key: 'health', icon: HeartPulse, label: 'Healthy targets', value: alb ? (alb.target_healthy ? 'healthy' : 'unhealthy') : '—', limit: 'all targets healthy', pass: alb ? alb.target_healthy : null },
    { key: 'err', icon: AlertOctagon, label: 'Error rate', value: gateNow ? pct(gateNow.err) : '—', limit: g ? `≤ ${pct(g.max_error_rate, 0)}` : '', pass: gateNow && g ? gateNow.err <= g.max_error_rate : null },
    { key: 'p95', icon: Timer, label: 'Latency p95', value: gateNow ? `${Math.round(gateNow.p95)} ms` : '—', limit: g ? `≤ ${g.max_p95_ms} ms` : '', pass: gateNow && g ? gateNow.p95 <= g.max_p95_ms : null },
    { key: 'share', icon: Split, label: 'Target share', value: gateNow ? pct(gateNow.share, 0) : '—', limit: g ? `≥ ${Math.round(g.min_target_share_ratio * 100)}% of ${live.weight}%` : '', pass: gateNow && g && live.phase === 'observing' && expected ? gateNow.share >= g.min_target_share_ratio * expected : null },
  ]

  const select = (id: string) => router.replace(`${pathname}?app=${id}`, { scroll: false })
  const canCutover = !!cap?.cutover && status === 'PROVISIONED' && !busy
  const canApply = !!cap?.provision && (status === 'PLANNED' || status === 'BLUEPRINTED' || status === 'FAILED') && !busy
  const canRetry = !!cap?.provision && (status === 'ROLLED_BACK' || status === 'FAILED') && !busy
  const wave0 = summary?.plan?.wave0 ?? []
  const cutoverDisabledWhy = !cap ? 'No target route for this app in Account B'
    : !cap.cutover ? cap.reason ?? 'Not cut over live'
    : busy ? 'A run is in progress for this app'
    : status !== 'PROVISIONED' ? `Needs PROVISIONED (now ${status ?? '—'}) — apply its blueprint first`
    : null

  if (!realAppIds.length) {
    return (
      <>
        <PageHeader eyebrow="Execute" title="Live cutover" />
        <Card><EmptyState icon={<Rocket />} title={online ? 'No apps discovered yet' : 'Orchestrator offline'} description={online ? 'Run discovery and build the wave plan first; the real apps show up here once they are planned.' : 'Start the orchestrator (uvicorn orchestrator.main:app --port 8000) to see live cutovers.'} action={<Link href="/" className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground">Go to overview</Link>} /></Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Execute"
        title="Live cutover"
        description={<>Real traffic through the edge ALB&apos;s weighted target groups. Code evaluates the gates after every step and rolls back on its own; the LLM{demo?.llm?.model ? ` (${demo.llm.model})` : ''} only writes the explanation afterwards.</>}
        actions={<>
          <Tip content="Arms the bad-wave variant for app-orders: its next blueprint drops UPSTREAM_URL but keeps REQUIRE_UPSTREAM=1, so / returns 500 while /health stays 200 — the gate must catch it.">
            <button onClick={() => setBadWave(!demo?.bad_wave?.['app-orders'], 'app-orders')} aria-pressed={!!demo?.bad_wave?.['app-orders']} className={cn('inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition', demo?.bad_wave?.['app-orders'] ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'bg-card hover:border-border-strong')}><Bomb className="size-4" />Bad wave (app-orders) {demo?.bad_wave?.['app-orders'] ? 'armed' : 'off'}</button>
          </Tip>
          {wave0.length > 0 && <button onClick={() => runWave(0)} disabled={isRunning('wave')} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-medium transition hover:border-border-strong disabled:opacity-50"><Play className="size-4" />Run wave 0 ({wave0.length} real apps)</button>}
          <Tip content={cutoverDisabledWhy ?? `Shift ${appId} ${(cfg?.steps ?? [10, 50, 100]).join(' → ')}% on the real ALB`}>
            <span><button onClick={() => runCutover(appId)} disabled={!canCutover} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-elev-1 transition hover:brightness-110 disabled:opacity-50">{busy && inFlight ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}{busy && inFlight ? 'Cutting over…' : `Cut over ${appId}`}</button></span>
          </Tip>
        </>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Choose app">
        {realAppIds.map(id => {
          const c = demo?.capabilities?.[id]
          return (
            <button key={id} role="radio" aria-checked={id === appId} onClick={() => select(id)} className={cn('inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] transition', id === appId ? 'border-primary/50 bg-primary/10 font-medium text-foreground' : 'bg-card text-muted-foreground hover:text-foreground', !c?.provision && 'opacity-60')}>
              <span className="font-mono">{id}</span>{statuses[id] && <StatusBadge status={statuses[id]} />}
              {isRunning(id) && <span className="live-dot size-1.5 text-primary" />}
            </button>
          )
        })}
      </div>

      {cap && !cap.cutover && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-[13px]" role="note">
          <AlertOctagon className="mt-0.5 size-4 shrink-0 text-warning" />
          <div><span className="font-medium">{appId} can&apos;t be cut over live.</span> <span className="text-muted-foreground">{cap.reason}{cap.provision ? ' It can still be provisioned on the golden pattern from the Blueprint page.' : ''}</span></div>
        </div>
      )}
      {!cap && status === 'PARKED' && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-[13px]" role="note">
          <Lock className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div><span className="font-medium">{appId} is parked (RED).</span> <span className="text-muted-foreground">{app?.tiering?.risk_summary ?? 'Stateful — needs a data-migration plan.'} The accelerator refuses to rehost it blindly, so it never gets a target.</span></div>
        </div>
      )}

      <Card className={cn('relative overflow-hidden transition-colors', live.phase === 'rolled_back' && 'border-destructive/40', live.phase === 'migrated' && 'border-success/40')}>
        <div className="relative grid grid-cols-1 gap-6 p-5 md:p-6 lg:grid-cols-[1fr_auto] lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {run ? <Badge tone={run.result === 'ROLLED_BACK' ? 'danger' : run.result === 'MIGRATED' ? 'success' : 'brand'}>{run.run_id}</Badge> : <Badge tone="neutral">no run yet</Badge>}
              {inFlight && <Badge tone="brand"><Radio className="size-3" />live</Badge>}
              <span className="font-mono">{app?.name ?? appId}</span>
              {cap?.path_prefix != null && <span>· listener rule {cap.listener_port ? `:${cap.listener_port}` : ''}{cap.path_prefix || '/*'}</span>}
              {alb && <Tip content={`Read from the ALB listener rule at ${clock(alb.read_at * 1000)}`}><span><Badge tone="info"><ShieldCheck className="size-3" />ALB weights · live</Badge></span></Tip>}
              {albErr && <Badge tone="warning">ALB read failed</Badge>}
            </div>
            <div className="mt-3 flex items-end gap-6">
              <div><div className="text-xs text-muted-foreground">Legacy</div><div className="text-4xl font-semibold tracking-tight text-legacy tabular md:text-5xl">{legacyPct}<span className="text-2xl">%</span></div></div>
              <div className="pb-2 text-subtle">/</div>
              <div><div className="text-xs text-muted-foreground">Target</div><div className="text-4xl font-semibold tracking-tight text-target tabular md:text-5xl">{targetPct}<span className="text-2xl">%</span></div></div>
            </div>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Traffic split: legacy ${legacyPct}%, target ${targetPct}%`}>
              <motion.div className="h-full bg-legacy" animate={{ width: `${legacyPct}%` }} transition={{ duration: 0.5 }} />
              <motion.div className="h-full bg-target" animate={{ width: `${targetPct}%` }} transition={{ duration: 0.5 }} />
            </div>
          </div>
          <div className="flex flex-col items-start gap-4 lg:items-end">
            {cfg && <Countdown windowStart={live.phase === 'observing' ? live.windowStart : null} windowS={cfg.observe_window_s} settleS={cfg.settle_s} label={live.phase === 'warmup' ? 'warming up' : live.phase === 'migrated' ? 'complete' : live.phase === 'rolled_back' ? 'rolled back' : 'idle'} />}
            <ol className="flex items-center gap-1.5" aria-label="Cutover steps">
              {live.steps.map((s, i) => {
                const current = live.phase === 'observing' && live.weight === s.weight && !s.gate
                return (
                  <li key={s.weight} className="flex items-center gap-1.5">
                    <Tip content={s.metrics ? `errors ${pct(s.metrics.error_rate)} · p95 ${Math.round(s.metrics.p95_ms ?? 0)} ms · target ${pct(s.metrics.target_share, 0)}${s.reasons ? ` · ${s.reasons.join('; ')}` : ''}` : `${s.weight}% step`}>
                      <span className={cn('flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium tabular', s.gate === 'PASS' && 'border-success/30 bg-success/10 text-success', s.gate === 'FAIL' && 'border-destructive/40 bg-destructive/10 text-destructive', current && 'border-primary/40 bg-primary/10 text-primary')}>
                        {s.gate === 'PASS' ? <CheckCircle2 className="size-3.5" /> : s.gate === 'FAIL' ? <XCircle className="size-3.5" /> : current ? <Loader2 className="size-3.5 animate-spin" /> : <Circle className="size-3.5 text-subtle" />}{s.weight}%
                      </span>
                    </Tip>
                    {i < live.steps.length - 1 && <span className="h-px w-3 bg-border-strong" />}
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
        <div className="relative px-5 pb-5 md:px-6">
          <TrafficFlow buckets={buckets} targetWeight={targetPct} active={inFlight} rolledBack={live.phase === 'rolled_back'} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>Each dot is one real request from the traffic generator (~20 req/s), drawn to the side that answered it (<code className="font-mono">served_by</code>); red = error.</span>
            {buckets.length > 0 && <span className="tabular">{buckets.reduce((a, b) => a + b.n, 0).toLocaleString()} requests in the last {Math.round((buckets[buckets.length - 1].t - buckets[0].t) / 60) || 1} min</span>}
          </div>
        </div>
      </Card>

      <AnimatePresence>
        {live.phase === 'rolled_back' && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="mt-4 overflow-hidden rounded-xl border border-destructive/40 bg-destructive/5">
            <div className="flex items-start gap-3 p-4 md:p-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive"><RotateCcw className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">Rolled back automatically{live.rollback?.at_weight != null ? ` at ${live.rollback.at_weight}%` : ''} — no human involved</div>
                <div className="mt-1 text-[13px] text-muted-foreground">
                  Gate: <span className="font-mono text-destructive">{live.rollback?.reason ?? run?.rollback?.reason}</span> · weights set back to legacy 100 / target 0 at {live.rollback ? clock(live.rollback.ts) : '—'}
                  {alb && alb.target === 0 && <> · <span className="font-medium text-foreground">ALB confirms 100/0</span> (read {clock(alb.read_at * 1000)})</>}
                  {' '}· target instance kept for debugging
                </div>
                <div className="mt-3 rounded-lg border bg-card p-3 text-[13px]">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary"><Bot className="size-3.5" />Explanation · written after the decision</div>
                  {run?.explanation ? <p className="leading-relaxed text-muted-foreground">{run.explanation}</p> : <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Waiting for the cutover record…</p>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={!canRetry} onClick={async () => { if (badWaveOn) await setBadWave(false, appId); runRetry(appId) }} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"><Wrench className="size-3.5" />{badWaveOn ? 'Disarm bad wave & fix/retry' : 'Fix & retry (apply -replace)'}</button>
                  <Link href={`/blueprint?app=${appId}`} className="inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium">Open blueprint</Link>
                  <Link href="/activity" className="inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium">Audit trail</Link>
                </div>
              </div>
            </div>
          </motion.div>
        )}
        {live.phase === 'migrated' && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex items-start gap-3 rounded-xl border border-success/40 bg-success/5 p-4 md:p-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success"><CheckCircle2 className="size-4" /></span>
            <div className="min-w-0 text-[13px]">
              <div className="text-[15px] font-semibold">{appId} migrated — 100% of its traffic now answers from the golden pattern in Account B</div>
              <div className="mt-1 text-muted-foreground">
                {live.startedAt && live.endedAt && <>Took {Math.round((live.endedAt - live.startedAt) / 1000)} s end to end. </>}
                {run?.history?.map(h => `${h.weight}%: errors ${pct(h.error_rate)}, p95 ${Math.round(h.p95_ms)} ms, target ${pct(h.target_share, 0)}`).join(' · ')}
              </div>
              {run?.explanation && <p className="mt-2 flex items-start gap-1.5 text-muted-foreground"><Bot className="mt-0.5 size-3.5 shrink-0 text-primary" />{run.explanation}</p>}
            </div>
          </motion.div>
        )}
        {live.phase === 'aborted' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-[13px]"><span className="font-medium">Cutover aborted before any traffic moved:</span> {live.abortReason}</motion.div>
        )}
      </AnimatePresence>

      {cap?.provision && status && ['PLANNED', 'BLUEPRINTED', 'FAILED'].includes(status) && !busy && (
        <Card className="mt-4">
          <EmptyState icon={<ShieldCheck />} title={`${appId} has no healthy target yet`} description={`Cutover precheck would abort: the target group in Account B is empty, so weights stay at legacy 100 / target 0. Apply the blueprint first — a real terraform apply into Account B.`}
            action={<div className="flex gap-2"><button onClick={() => runBlueprint(appId, true)} disabled={!canApply} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50"><Play className="size-4" />Apply blueprint</button><Link href={`/blueprint?app=${appId}`} className="inline-flex h-9 items-center rounded-lg border px-3 text-[13px] font-medium">Watch it on Blueprint</Link></div>} />
        </Card>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {gates.map(gt => (
          <Card key={gt.key} className={cn('relative p-4 transition-colors', gt.pass === false && 'border-destructive/40 bg-destructive/5', gt.pass === true && 'border-success/25')}>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><gt.icon className="size-3.5" />{gt.label}
              <span className={cn('ml-auto size-2 rounded-full', gt.pass === null ? 'bg-border-strong' : gt.pass ? 'bg-success' : 'bg-destructive')} />
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight tabular">{gt.value}</div>
            <div className="mt-0.5 text-[11px] text-subtle">threshold {gt.limit}{gateNow && gt.key !== 'health' ? ` · ${gateNow.n} req` : ''}</div>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader icon={<Activity />} title="Live traffic" description="Per-second buckets of the generator's real requests: share answered by the target, the ALB weight, and the error rate" action={<Legend items={[{ label: 'Target share %', color: 'var(--target)' }, { label: 'ALB weight %', color: 'var(--subtle-foreground)' }, { label: 'Error rate %', color: 'var(--destructive)' }]} />} />
        <div className="h-72 px-2 pb-3 pt-4">
          {series.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ left: 0, right: 8 }}>
                <defs><linearGradient id="share" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--target)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--target)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={t => `${Math.round(t)}s`} {...axisProps} />
                <YAxis domain={[0, 100]} width={36} tickFormatter={v => `${v}%`} {...axisProps} />
                <Tooltip content={<ChartTooltip labelFormatter={t => `t + ${Number(t).toFixed(0)} s`} formatter={v => (v == null ? '—' : `${Number(v).toFixed(0)}%`)} />} />
                <Area type="monotone" dataKey="share" name="Target share" stroke="var(--target)" strokeWidth={2} fill="url(#share)" isAnimationActive={false} connectNulls />
                <Line type="stepAfter" dataKey="weight" name="ALB weight" stroke="var(--subtle-foreground)" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="err" name="Error rate" stroke="var(--destructive)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState icon={<Gauge />} title="No traffic in the last 4 minutes" description={cap?.cutover ? `The traffic generator runs during a cutover. ${status === 'PROVISIONED' ? `${appId} is healthy on the target and ready.` : ''}` : 'Live traffic is only generated for apps that can be cut over.'} />
          )}
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Lock />} title="Guardrails" description="What makes this safe to run unattended" />
          <ul className="flex flex-col gap-2.5 p-5 pt-4 text-[13px] text-muted-foreground">
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />Rollback is deterministic code — one <code className="font-mono text-xs">modify_rule</code> call back to 100/0, in a <code className="font-mono text-xs">finally</code> path.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />The orchestrator&apos;s watchdog resets weights if a cutover&apos;s heartbeat goes stale for 5 s (a hard-killed run).</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />Mutations only touch resources tagged <code className="font-mono text-xs">managed-by=migration-accelerator</code>.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />The LLM writes the explanation after the decision — it never triggers or blocks a rollback.</li>
          </ul>
        </Card>
        <Card>
          <CardHeader title="Break-glass controls" description="Operator overrides on the real ALB — logged as WEIGHT_SET (manual)" action={<InfoTip>Disabled while a run is in progress for this app, so a human can&apos;t race the controller.</InfoTip>} />
          <div className="flex flex-wrap gap-2 p-5 pt-4">
            {[0, 50, 100].map(w => (
              <button key={w} disabled={busy || !cap?.provision || (w > 0 && status !== 'PROVISIONED' && status !== 'MIGRATED')} onClick={() => setManualWeight(appId, w)} className={cn('inline-flex h-9 items-center rounded-lg border px-3 font-mono text-[13px] transition hover:border-border-strong disabled:opacity-40', targetPct === w && !inFlight && 'border-primary/50 bg-primary/10')}>
                {100 - w} / {w}
              </button>
            ))}
            <span className="self-center text-[11px] text-muted-foreground">{w0Hint(status)}</span>
          </div>
        </Card>
      </div>
    </>
  )
}

function w0Hint(status: string | undefined) {
  if (status === 'PROVISIONED' || status === 'MIGRATED') return 'Target is healthy: any split is allowed.'
  return 'Only 100/0 until the target is provisioned.'
}
