'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, CheckCircle2, Circle, ClipboardCopy, FileCode2, Loader2, Lock, Play, ShieldCheck, Sparkles, SquareTerminal, Wand2, Wrench, XCircle } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { FindingCode } from '@/lib/contracts'
import { BLUEPRINT_STAGES, blueprintLive } from '@/lib/live'
import { FINDING_META } from '@/lib/meta'
import { cn } from '@/lib/utils'
import { PageHeader, StatusBadge } from '@/components/console/bits'
import { useConsole } from '@/components/console/console-provider'
import { Badge, Card, CardHeader, EmptyState, Progress, Segmented, Tip } from '@/components/ui/primitives'

function CodePane({ title, tone, lines, highlight, file }: { title: string; tone: 'legacy' | 'target'; lines: string[]; highlight: Set<number>; file: string }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border', tone === 'legacy' ? 'border-destructive/25' : 'border-success/25')}>
      <div className="flex items-center gap-2 border-b bg-surface-2/60 px-4 py-2.5 text-xs font-medium">
        <span className={cn('size-2 rounded-full', tone === 'legacy' ? 'bg-destructive' : 'bg-success')} />{title}
        <span className="ml-auto font-mono text-[11px] text-subtle">{file}</span>
      </div>
      <pre className="scrollbar-thin max-h-[520px] overflow-auto bg-code py-3 font-mono text-[12px] leading-6">
        {lines.map((l, i) => (
          <div key={i} className={cn('flex px-3 transition-colors', highlight.has(i + 1) && (tone === 'legacy' ? 'bg-destructive/12 text-destructive' : 'bg-success/12 text-success'), l.trim().startsWith('#') && !highlight.has(i + 1) && 'text-subtle')}>
            <span className="mr-4 w-6 shrink-0 select-none text-right text-subtle/70">{i + 1}</span>
            <span className="whitespace-pre">{l || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}

function UnifiedPane({ before, after, annotations }: { before: string[]; after: string[]; annotations: { before_line: number | null; after_line: number | null }[] }) {
  const removed = new Set(annotations.map(a => a.before_line).filter(Boolean) as number[])
  const added = new Set(annotations.map(a => a.after_line).filter(Boolean) as number[])
  return (
    <pre className="code-block scrollbar-thin max-h-[560px] overflow-auto py-3 text-[12px] leading-6">
      {before.map((l, i) => removed.has(i + 1) && <div key={`b${i}`} className="flex bg-destructive/10 px-3 text-destructive"><span className="mr-3 w-4 select-none">−</span><span className="whitespace-pre">{l}</span></div>)}
      {after.map((l, i) => <div key={`a${i}`} className={cn('flex px-3', added.has(i + 1) ? 'bg-success/10 text-success' : 'text-muted-foreground')}><span className="mr-3 w-4 select-none">{added.has(i + 1) ? '+' : ' '}</span><span className="whitespace-pre">{l || ' '}</span></div>)}
    </pre>
  )
}

function lineTone(line: string) {
  if (/error|failed/i.test(line)) return 'text-destructive'
  if (/Apply complete|Creation complete|Destruction complete|Success|successfully|No changes/i.test(line)) return 'text-success'
  if (/Creating\.\.\.|Still creating|Modifying|Destroying|Plan:/i.test(line)) return 'text-warning'
  if (/^\s*[+~-] /.test(line)) return 'text-info'
  return 'text-muted-foreground'
}

function Terminal({ log, running, empty }: { log: { id: number; tool: string; line: string }[]; running: boolean; empty: string }) {
  const ref = useRef<HTMLPreElement>(null)
  const [follow, setFollow] = useState(true)
  useEffect(() => { if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [log.length, follow])
  return (
    <div className="overflow-hidden rounded-xl border bg-code">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-xs">
        <span className="flex gap-1"><span className="size-2.5 rounded-full bg-destructive/70" /><span className="size-2.5 rounded-full bg-warning/70" /><span className="size-2.5 rounded-full bg-success/70" /></span>
        <span className="ml-2 font-mono text-muted-foreground">terraform · streamed from the Blueprint agent</span>
        {running && <span className="ml-auto flex items-center gap-1.5 text-primary"><span className="live-dot size-1.5" />live</span>}
        <label className={cn('flex items-center gap-1 text-muted-foreground', !running && 'ml-auto')}><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> follow</label>
      </div>
      <pre ref={ref} className="scrollbar-thin h-72 overflow-auto px-4 py-3 font-mono text-[11.5px] leading-5">
        {log.length === 0 ? <span className="text-subtle">{empty}</span> : log.map(l => (
          <div key={l.id} className="flex gap-3">
            <span className="w-28 shrink-0 select-none text-subtle">{l.tool.replace('terraform ', 'tf ')}</span>
            <span className={cn('whitespace-pre-wrap break-all', lineTone(l.line))}>{l.line || ' '}</span>
          </div>
        ))}
        {running && <span className="inline-block h-3.5 w-2 animate-pulse bg-primary align-middle" />}
      </pre>
    </div>
  )
}

export function BlueprintView() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { realAppIds, fleetById, blueprints, statuses, events, demo, runBlueprint, runRetry, setBadWave, isRunning, summary, online } = useConsole()
  const [mode, setMode] = useState<'split' | 'unified'>('split')
  const [hover, setHover] = useState<FindingCode | null>(null)

  const requested = params.get('app') ?? ''
  const appId = realAppIds.includes(requested) ? requested : (realAppIds.find(id => demo?.capabilities?.[id]?.provision) ?? realAppIds[0] ?? 'app-catalog')
  const app = fleetById.get(appId)
  const cap = demo?.capabilities?.[appId]
  const status = statuses[appId]
  const bp = blueprints[appId] ?? null
  const live = useMemo(() => blueprintLive(events, appId), [events, appId])
  const busy = isRunning(appId)
  const running = busy && live.started && !live.done && !live.failed
  const stage = live.started ? live.stage : bp ? (bp.status === 'PROVISIONED' ? BLUEPRINT_STAGES.length : 4) : 0
  const badWaveOn = !!demo?.bad_wave?.[appId]
  const parked = status === 'PARKED'
  const canDry = !!app && !parked && status !== 'MIGRATED' && status !== 'CUTTING_OVER' && status !== 'TIERED' && status !== 'DISCOVERED' && !busy
  const canApply = !!cap?.provision && canDry && status !== 'PROVISIONED' && status !== 'ROLLED_BACK'
  const canRetry = !!cap?.provision && (status === 'ROLLED_BACK' || status === 'FAILED' || status === 'PROVISIONED') && !busy
  const applyWhy = parked ? 'Parked (RED): never rehosted' : !cap?.provision ? 'No target route in Account B' : busy ? 'A run is in progress' : status === 'PROVISIONED' ? 'Already provisioned — cut it over next' : status === 'ROLLED_BACK' ? 'Use Fix & retry (apply -replace)' : !canDry ? `Not in a plannable state (${status ?? '—'})` : null

  const before = bp?.diff.before.split('\n') ?? []
  const after = bp?.diff.after.split('\n') ?? []
  const hl = (side: 'before' | 'after') => new Set((bp?.diff.annotations ?? []).filter(a => !hover || a.finding === hover).map(a => (side === 'before' ? a.before_line : a.after_line)).filter(Boolean) as number[])
  const missingUpstream = !!bp && bp.inputs.env.REQUIRE_UPSTREAM === '1' && !bp.inputs.env.UPSTREAM_URL
  const select = (id: string) => router.replace(`${pathname}?app=${id}`, { scroll: false })
  const synthBlueprinted = (summary?.statuses_synthetic?.BLUEPRINTED ?? 0) + (summary?.statuses_synthetic?.MIGRATED ?? 0) + (summary?.statuses_synthetic?.ROLLED_BACK ?? 0)

  if (!realAppIds.length) {
    return (
      <>
        <PageHeader eyebrow="Execute" title="Blueprint & IaC" />
        <Card><EmptyState icon={<ShieldCheck />} title={online ? 'No apps discovered yet' : 'Orchestrator offline'} description={online ? 'Run discovery and planning first; the real apps appear here.' : 'Start the orchestrator to generate blueprints.'} /></Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Execute"
        title="Blueprint & IaC"
        description="The LLM never writes Terraform. Rules (optionally refined by the LLM) fill the golden_app inputs — the pattern already live as app-hello in Account B — and code renders, validates and applies the HCL."
        actions={<>
          <Tip content={canDry ? 'Map → validate → render → diff → terraform init/validate (no AWS changes)' : applyWhy ?? ''}>
            <span><button disabled={!canDry} onClick={() => runBlueprint(appId, false)} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-medium transition hover:border-border-strong disabled:opacity-50"><Wand2 className="size-4" />Generate (dry run)</button></span>
          </Tip>
          {canRetry ? (
            <button onClick={async () => { if (badWaveOn) await setBadWave(false, appId); runRetry(appId) }} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-elev-1 transition hover:brightness-110"><Wrench className="size-4" />{status === 'PROVISIONED' ? 'Re-apply (-replace)' : badWaveOn ? 'Disarm bad wave & retry' : 'Fix & retry (-replace)'}</button>
          ) : (
            <Tip content={applyWhy ?? 'Real terraform apply into Account B, then wait for the target group to report healthy'}>
              <span><button disabled={!canApply} onClick={() => runBlueprint(appId, true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-elev-1 transition hover:brightness-110 disabled:opacity-50">
                {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Generate &amp; apply
              </button></span>
            </Tip>
          )}
        </>}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Choose app">
        {realAppIds.map(id => {
          const a = fleetById.get(id)!
          const s = statuses[id]
          const active = id === appId
          const isParked = s === 'PARKED'
          return (
            <button key={id} role="radio" aria-checked={active} onClick={() => select(id)} className={cn('surface surface-interactive flex items-start gap-3 p-4 text-left', active && 'border-primary/50 glow-brand', isParked && 'opacity-70')}>
              <span className={cn('flex size-9 items-center justify-center rounded-lg', active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground')}>{isParked ? <Lock className="size-4" /> : <FileCode2 className="size-4" />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2"><span className="font-mono text-[13px] font-medium">{id}</span>{s && <StatusBadge status={s} />}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{a.name} · {a.findings.length} findings{a.depends_on[0] ? ` · calls ${a.depends_on[0]}` : ''}{isRunning(id) ? ' · running' : ''}</span>
              </span>
            </button>
          )
        })}
      </div>

      {parked && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-[13px]" role="note">
          <Lock className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div><span className="font-medium">{appId} is parked (RED) — no blueprint is generated.</span> <span className="text-muted-foreground">{app?.tiering?.risk_summary}</span></div>
        </div>
      )}

      <Card className="mt-4">
        <CardHeader icon={<ShieldCheck />} title="Pipeline" description={`golden_app@v1 · generated/${appId}/main.tf`} action={<Badge tone={live.failed ? 'danger' : bp?.status === 'PROVISIONED' ? 'target' : running ? 'brand' : 'neutral'}>{live.failed ? 'failed' : running ? 'running' : bp?.status === 'PROVISIONED' ? 'provisioned' : bp ? (bp.validate_ok ? 'validated' : 'rendered') : 'not generated'}</Badge>} />
        <div className="p-5">
          <Progress value={(stage / BLUEPRINT_STAGES.length) * 100} tone={live.failed ? 'danger' : bp?.status === 'PROVISIONED' ? 'target' : 'brand'} />
          <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {BLUEPRINT_STAGES.map((s, i) => {
              const done = stage > i || (live.done && i <= stage)
              const current = running && stage === i
              const failedHere = !!live.failed && stage === i
              const skipped = live.started && !live.apply && i >= 4
              return (
                <li key={s} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs', failedHere ? 'border-destructive/40 bg-destructive/5' : done && !skipped ? 'border-success/25 bg-success/5' : current ? 'border-primary/40 bg-primary/5' : 'text-muted-foreground', skipped && 'opacity-50')}>
                  {failedHere ? <XCircle className="size-3.5 shrink-0 text-destructive" /> : done && !skipped ? <CheckCircle2 className="size-3.5 shrink-0 text-success" /> : current ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" /> : <Circle className="size-3.5 shrink-0 text-subtle" />}
                  <span className="truncate">{s}{skipped ? ' (dry run)' : ''}</span>
                </li>
              )
            })}
          </ol>
          {live.failed && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs text-destructive">{live.failed}</p>}
          {bp?.status === 'PROVISIONED' && bp.outputs && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {bp.outputs.instance_ids?.map(i => <Badge key={i} tone="target" className="font-mono">{i}</Badge>)}
              <Badge tone="neutral" className="font-mono">target group healthy</Badge>
              {live.startedAt && live.endedAt && <Badge tone="neutral">apply took {Math.round((live.endedAt - live.startedAt) / 1000)} s</Badge>}
            </div>
          )}
          <div className="mt-4"><Terminal log={live.log} running={running} empty={live.started ? 'Waiting for terraform output…' : 'No terraform run for this app yet. Generate & apply to stream it here.'} /></div>
        </div>
      </Card>

      <AnimatePresence>
        {(missingUpstream || badWaveOn) && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="text-[13px]"><div className="font-medium">{missingUpstream ? 'Bad-wave variant: UPSTREAM_URL dropped' : 'Bad wave armed for this app'}</div><p className="mt-0.5 text-muted-foreground">Terraform stays valid and /health stays 200 — but with REQUIRE_UPSTREAM=1 the app returns 500 on /. The cutover gate must catch it and roll back.{!missingUpstream ? ' The next blueprint will ship without UPSTREAM_URL.' : ''}</p></div>
          </motion.div>
        )}
      </AnimatePresence>

      {!bp ? (
        !parked && <Card className="mt-4"><EmptyState icon={<FileCode2 />} title="No blueprint generated yet" description="Generate a dry run to see the legacy → golden_app diff with every finding annotated, or generate & apply to provision it for real." /></Card>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_340px]">
          <Card className="min-w-0">
            <CardHeader
              title="Configuration diff"
              description="Legacy config as discovered (left) vs. the generated Terraform (right). Hover a fix to trace it."
              action={<div className="flex items-center gap-2">
                <Segmented label="Diff mode" size="sm" value={mode} onChange={setMode} options={[{ value: 'split', label: 'Split' }, { value: 'unified', label: 'Unified' }]} />
                <button onClick={() => { navigator.clipboard?.writeText(bp.diff.after); toast.success('main.tf copied') }} className="flex size-8 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:text-foreground" aria-label="Copy generated main.tf"><ClipboardCopy className="size-4" /></button>
              </div>}
            />
            <div className="p-5">
              {mode === 'split' ? (
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <CodePane title="Legacy · Account A" tone="legacy" lines={before} highlight={hl('before')} file="discovered record" />
                  <CodePane title="Generated · Account B" tone="target" lines={after} highlight={hl('after')} file={bp.tf_dir + '/main.tf'} />
                </div>
              ) : <UnifiedPane before={before} after={after} annotations={bp.diff.annotations} />}
            </div>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader title={`${bp.fixes.length} annotated fixes`} description="Each finding → the golden_app control that closes it" />
              <ul className="flex flex-col gap-1 p-3" onMouseLeave={() => setHover(null)}>
                {bp.fixes.map(f => (
                  <li key={f.finding}>
                    <button onMouseEnter={() => setHover(f.finding)} onFocus={() => setHover(f.finding)} onBlur={() => setHover(null)} className={cn('flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition', hover === f.finding ? 'bg-success/10' : 'hover:bg-surface-2')}>
                      <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                      <span className="min-w-0"><span className="block font-mono text-[11px] font-medium">{f.finding}</span><span className="block text-xs text-muted-foreground">{f.fix || FINDING_META[f.finding]?.fix}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            {bp.gaps.length > 0 && (
              <Card>
                <CardHeader title="Gaps flagged" description="Defaulted safely — owner review needed" />
                <ul className="flex flex-col gap-2 p-4 pt-3">{bp.gaps.map(gp => <li key={gp.field} className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-xs"><span className="font-mono font-medium">{gp.field}</span><p className="mt-0.5 text-muted-foreground">{gp.note}</p></li>)}</ul>
              </Card>
            )}
            <Card>
              <CardHeader icon={<Sparkles />} title="golden_app inputs" description="The only thing the mapper produces — schema-validated before render" />
              <pre className="code-block scrollbar-thin mx-4 mb-4 overflow-x-auto p-3 text-[11.5px] leading-5">{JSON.stringify(bp.inputs, null, 2)}</pre>
            </Card>
            <Card className="p-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 font-medium text-foreground"><SquareTerminal className="size-3.5" />Synthetic fleet</div>
              <p className="mt-1">Synthetic apps run map → validate → render → diff only (no AWS). {synthBlueprinted > 0 ? <><span className="font-medium text-foreground">{synthBlueprinted.toLocaleString()}</span> have been dry-run so far, as part of their waves.</> : 'None dry-run yet — run a wave from the Plan page.'} Only the real apps are applied.</p>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
