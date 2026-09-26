'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, CheckCircle2, Circle, ClipboardCopy, FileCode2, Loader2, Play, ShieldCheck, Sparkles, Wand2 } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { FindingCode } from '@/lib/contracts'
import { buildBlueprint } from '@/lib/data/blueprint'
import { FINDING_META, REAL_APP_IDS, fleetById } from '@/lib/data/fleet'
import { cn } from '@/lib/utils'
import { PageHeader, StatusBadge } from '@/components/console/bits'
import { BLUEPRINT_STAGES, useConsole } from '@/components/console/console-provider'
import { Badge, Card, CardHeader, Progress, Segmented } from '@/components/ui/primitives'

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

export function BlueprintView() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const appId = (REAL_APP_IDS as readonly string[]).includes(params.get('app') ?? '') ? params.get('app')! : 'app-catalog'
  const { blueprints, runBlueprint, badWave, agents, statuses } = useConsole()
  const [mode, setMode] = useState<'split' | 'unified'>('split')
  const [hover, setHover] = useState<FindingCode | null>(null)

  const state = blueprints[appId]
  const bp = useMemo(() => state ?? buildBlueprint(appId, { badWave: badWave && appId === 'app-orders' }), [state, appId, badWave])
  const before = bp.diff.before.split('\n')
  const after = bp.diff.after.split('\n')
  const hl = (side: 'before' | 'after') => new Set(bp.diff.annotations.filter(a => !hover || a.finding === hover).map(a => (side === 'before' ? a.before_line : a.after_line)).filter(Boolean) as number[])
  const running = state?.running ?? false
  const stage = state?.stage ?? 0
  const missingUpstream = bp.inputs.env.REQUIRE_UPSTREAM === '1' && !bp.inputs.env.UPSTREAM_URL
  const select = (id: string) => router.replace(`${pathname}?app=${id}`, { scroll: false })

  return (
    <>
      <PageHeader
        eyebrow="Execute"
        title="Blueprint & IaC"
        description="The LLM never writes Terraform. It fills five inputs to golden_app — the pattern already live as app-hello — and code renders, validates and applies the HCL."
        actions={<>
          <button disabled={running || agents.blueprint === 'running'} onClick={() => runBlueprint(appId, false)} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-medium transition hover:border-border-strong disabled:opacity-50"><Wand2 className="size-4" />Generate (dry run)</button>
          <button disabled={running || agents.blueprint === 'running'} onClick={() => runBlueprint(appId, true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-elev-1 transition hover:brightness-110 disabled:opacity-50">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}{bp.status === 'PROVISIONED' ? 'Re-apply (-replace)' : 'Generate & apply'}
          </button>
        </>}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Choose app">
        {REAL_APP_IDS.map(id => {
          const a = fleetById.get(id)!
          const s = statuses[id]
          const active = id === appId
          return (
            <button key={id} role="radio" aria-checked={active} onClick={() => select(id)} className={cn('surface surface-interactive flex items-start gap-3 p-4 text-left', active && 'border-primary/50 glow-brand')}>
              <span className={cn('flex size-9 items-center justify-center rounded-lg', active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground')}><FileCode2 className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2"><span className="font-mono text-[13px] font-medium">{id}</span>{s && <StatusBadge status={s} />}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{a.name} · {a.findings.length} findings{a.depends_on[0] ? ` · calls ${a.depends_on[0]}` : ''}</span>
              </span>
            </button>
          )
        })}
      </div>

      <Card className="mt-4">
        <CardHeader icon={<ShieldCheck />} title="Pipeline" description={`golden_app@v1 · generated/${appId}/main.tf`} action={<Badge tone={bp.status === 'PROVISIONED' ? 'target' : running ? 'brand' : 'neutral'}>{running ? 'running' : bp.status === 'PROVISIONED' ? 'provisioned' : state ? 'validated' : 'not generated'}</Badge>} />
        <div className="p-5">
          <Progress value={(stage / BLUEPRINT_STAGES.length) * 100} tone={bp.status === 'PROVISIONED' ? 'target' : 'brand'} />
          <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {BLUEPRINT_STAGES.map((s, i) => {
              const done = stage > i
              const current = running && stage === i
              return (
                <li key={s} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs', done ? 'border-success/25 bg-success/5' : current ? 'border-primary/40 bg-primary/5' : 'text-muted-foreground')}>
                  {done ? <CheckCircle2 className="size-3.5 shrink-0 text-success" /> : current ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" /> : <Circle className="size-3.5 shrink-0 text-subtle" />}
                  <span className="truncate">{s}</span>
                </li>
              )
            })}
          </ol>
        </div>
      </Card>

      <AnimatePresence>
        {missingUpstream && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="text-[13px]"><div className="font-medium">Bad-wave variant: UPSTREAM_URL dropped after validation</div><p className="mt-0.5 text-muted-foreground">Terraform is still valid and /health stays 200 — but with REQUIRE_UPSTREAM=1, the app returns 500 on /. This is exactly the class of bug the Cutover gate must catch.</p></div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_340px]">
        <Card className="min-w-0">
          <CardHeader
            title="Configuration diff"
            description="Legacy config (left) vs. generated Terraform (right). Hover a fix to trace it."
            action={<div className="flex items-center gap-2">
              <Segmented label="Diff mode" size="sm" value={mode} onChange={setMode} options={[{ value: 'split', label: 'Split' }, { value: 'unified', label: 'Unified' }]} />
              <button onClick={() => { navigator.clipboard?.writeText(bp.diff.after); toast.success('main.tf copied') }} className="flex size-8 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:text-foreground" aria-label="Copy generated main.tf"><ClipboardCopy className="size-4" /></button>
            </div>}
          />
          <div className="p-5">
            {mode === 'split' ? (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <CodePane title="Legacy · Account A" tone="legacy" lines={before} highlight={hl('before')} file="scan summary" />
                <CodePane title="Generated · Account B" tone="target" lines={after} highlight={hl('after')} file={`generated/${appId}/main.tf`} />
              </div>
            ) : <UnifiedPane before={before} after={after} annotations={bp.diff.annotations} />}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={`${bp.fixes.length} annotated fixes`} description="Each finding → the golden_app control that closes it" />
            <ul className="flex flex-col gap-1 p-3" onMouseLeave={() => setHover(null)}>
              {bp.diff.annotations.map(a => (
                <li key={a.finding}>
                  <button onMouseEnter={() => setHover(a.finding)} onFocus={() => setHover(a.finding)} onBlur={() => setHover(null)} className={cn('flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition', hover === a.finding ? 'bg-success/10' : 'hover:bg-surface-2')}>
                    <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                    <span className="min-w-0"><span className="block font-mono text-[11px] font-medium">{a.finding}</span><span className="block text-xs text-muted-foreground">{FINDING_META[a.finding].fix}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {bp.gaps.length > 0 && (
            <Card>
              <CardHeader title="Gaps flagged" description="flag_gap(): defaulted safely, owner review needed" />
              <ul className="flex flex-col gap-2 p-4 pt-3">{bp.gaps.map(g => <li key={g.field} className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-xs"><span className="font-mono font-medium">{g.field}</span><p className="mt-0.5 text-muted-foreground">{g.note}</p></li>)}</ul>
            </Card>
          )}
          <Card>
            <CardHeader icon={<Sparkles />} title="set_golden_inputs()" description="The only output the LLM can produce — schema-validated" />
            <pre className="code-block scrollbar-thin mx-4 mb-4 overflow-x-auto p-3 text-[11.5px] leading-5">{JSON.stringify(bp.inputs, null, 2)}</pre>
          </Card>
          <Card className="p-4 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Synthetic fleet</div>
            <p className="mt-1">1,000 synthetic apps run steps 1–5 only (map → validate → render → diff): <span className="font-medium text-foreground">0 render errors</span>. Only the 3 live apps are applied.</p>
          </Card>
        </div>
      </div>
    </>
  )
}
