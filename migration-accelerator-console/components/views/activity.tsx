'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Bot, ChevronRight, Cpu, Download, Filter, Inbox, Loader2, Pause, Play, Radar, Search, SearchX, TerminalSquare, User } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { ConsoleEvent } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/console/bits'
import { useConsole } from '@/components/console/console-provider'
import { Badge, Card, EmptyState, Input, Segmented } from '@/components/ui/primitives'

const LEVEL_DOT: Record<ConsoleEvent['level'], string> = { info: 'bg-info', success: 'bg-success', warn: 'bg-warning', error: 'bg-destructive' }
const LEVEL_TEXT: Record<ConsoleEvent['level'], string> = { info: 'text-info', success: 'text-success', warn: 'text-warning', error: 'text-destructive' }
const PAGE = 200

// Terraform streams every output line as a TOOL_CALL event; they can outnumber everything else.
const isToolOutput = (e: ConsoleEvent) => e.type === 'TOOL_CALL'

const timeOf = (ts: string) => new Date(ts).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

function DecidedBy({ by }: { by?: 'rules' | 'llm' }) {
  if (!by) return null
  return by === 'llm'
    ? <Badge tone="brand" className="text-[10px]"><Bot className="size-3" />LLM</Badge>
    : <Badge tone="neutral" className="text-[10px]"><Cpu className="size-3" />rules</Badge>
}

export function ActivityFeed({ limit = 8, compact, hideToolOutput = true }: { limit?: number; compact?: boolean; hideToolOutput?: boolean }) {
  const { events } = useConsole()
  const shown = useMemo(() => {
    const out: ConsoleEvent[] = []
    for (const e of events) {
      if (hideToolOutput && isToolOutput(e)) continue
      out.push(e)
      if (out.length >= limit) break
    }
    return out
  }, [events, limit, hideToolOutput])
  if (!shown.length) return <p className="px-2 py-6 text-center text-xs text-muted-foreground">No agent activity yet.</p>
  return (
    <ol className="flex flex-col" aria-label="Recent events">
      <AnimatePresence initial={false}>
        {shown.map(e => (
          <motion.li key={e.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-3 rounded-lg px-2 py-2 transition hover:bg-surface-2">
            <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', LEVEL_DOT[e.level])} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn('font-mono text-[11px] font-medium', LEVEL_TEXT[e.level])}>{e.type}</span>
                {!compact && <DecidedBy by={e.decided_by} />}
                <span className="ml-auto font-mono text-[10.5px] text-subtle tabular">{timeOf(e.ts)}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{e.summary}</p>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  )
}

type AgentFilter = 'all' | ConsoleEvent['agent']

export function ActivityView() {
  const { events, loading, online, summary, agents, runDiscovery } = useConsole()
  const [q, setQ] = useState('')
  const [agent, setAgent] = useState<AgentFilter>('all')
  const [level, setLevel] = useState<'all' | ConsoleEvent['level']>('all')
  const [decided, setDecided] = useState<'all' | 'llm' | 'rules'>('all')
  const [hideTools, setHideTools] = useState(true)
  const [paused, setPaused] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const frozen = useRef<ConsoleEvent[] | null>(null)
  if (paused && !frozen.current) frozen.current = events
  if (!paused) frozen.current = null
  const source = frozen.current ?? events
  const newestFrozen = source[0]?.id ?? 0
  const pending = paused ? events.filter(e => e.id > newestFrozen).length : 0

  const rows = useMemo(() => source.filter(e =>
    (!hideTools || !isToolOutput(e)) &&
    (agent === 'all' || e.agent === agent) &&
    (level === 'all' || e.level === level) &&
    (decided === 'all' || e.decided_by === decided) &&
    (!q || `${e.type} ${e.summary} ${e.app_id ?? ''} ${JSON.stringify(e.payload)}`.toLowerCase().includes(q.toLowerCase())),
  ), [source, agent, level, decided, q, hideTools])

  const counts = useMemo(() => {
    let llm = 0, errors = 0, tools = 0
    for (const e of events) {
      if (e.decided_by === 'llm') llm++
      if (e.level === 'error') errors++
      if (isToolOutput(e)) tools++
    }
    return { total: events.length, llm, errors, tools }
  }, [events])
  const hiddenTools = useMemo(() => (hideTools ? source.filter(isToolOutput).length : 0), [hideTools, source])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `events-${Date.now()}.json` })
    a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Activity & audit trail"
        description="Every agent step, tool call and gate decision — the same stream the orchestrator serves at GET /events. Expand a row for its arguments."
        actions={<>
          <button onClick={() => setPaused(!paused)} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-medium transition hover:border-border-strong" aria-pressed={paused}>
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}{paused ? `Resume${pending ? ` (${pending} new)` : ''}` : 'Pause stream'}
          </button>
          <button onClick={() => setHideTools(!hideTools)} aria-pressed={hideTools} className={cn('inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition hover:border-border-strong', hideTools ? 'border-primary/40 bg-primary/10' : 'bg-card')}>
            <TerminalSquare className="size-4" />{hideTools ? 'Show terraform output' : 'Hide terraform output'}
          </button>
          <button onClick={exportJson} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-medium transition hover:border-border-strong"><Download className="size-4" />Export JSON</button>
        </>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-2xl sm:grid-cols-4">
        {([['Events', counts.total], ['LLM decisions', counts.llm], ['Errors', counts.errors], ['Terraform lines', counts.tools]] as const).map(([l, v]) => (
          <div key={l} className="surface px-4 py-3"><div className="text-xs text-muted-foreground">{l}</div><div className="mt-1 text-xl font-semibold tabular">{v.toLocaleString()}</div></div>
        ))}
      </div>
      <Card>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <Input icon={<Search />} value={q} onChange={e => setQ(e.target.value)} placeholder="Search type, app, tool, payload…" aria-label="Search events" className="lg:w-80" />
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="size-4 text-subtle" aria-hidden />
            <Segmented label="Agent" size="sm" value={agent} onChange={setAgent} options={[{ value: 'all', label: 'All' }, { value: 'discovery', label: 'Discovery' }, { value: 'planning', label: 'Planning' }, { value: 'blueprint', label: 'Blueprint' }, { value: 'cutover', label: 'Cutover' }, { value: 'orchestrator', label: 'Orchestrator' }]} />
            <Segmented label="Level" size="sm" value={level} onChange={setLevel} options={[{ value: 'all', label: 'Any' }, { value: 'info', label: 'Info' }, { value: 'success', label: 'OK' }, { value: 'warn', label: 'Warn' }, { value: 'error', label: 'Error' }]} />
            <Segmented label="Decided by" size="sm" value={decided} onChange={setDecided} options={[{ value: 'all', label: 'Any' }, { value: 'rules', label: 'Rules' }, { value: 'llm', label: 'LLM' }]} />
          </div>
          <div className="text-xs text-subtle tabular lg:ml-auto">
            {rows.length.toLocaleString()} of {source.length.toLocaleString()}
            {hiddenTools > 0 && <span> · {hiddenTools.toLocaleString()} terraform lines hidden</span>}
          </div>
        </div>
        {loading && !events.length ? (
          <div className="flex items-center justify-center gap-2 py-14 text-xs text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin text-primary" /> Connecting to the orchestrator event stream…</div>
        ) : !events.length ? (
          <EmptyState
            icon={<Inbox />}
            title={online ? 'No events yet' : 'Orchestrator offline'}
            description={!online
              ? 'The event stream reconnects automatically once the orchestrator is reachable.'
              : summary?.discovered
                ? 'The event log is empty. Run an agent from the command palette (Ctrl K) to generate events.'
                : 'Nothing has run yet. Start with discovery — every agent step streams in here live.'}
            action={online && !summary?.discovered ? (
              <button onClick={() => { void runDiscovery() }} disabled={agents.discovery === 'running'} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-elev-1 transition hover:brightness-110 disabled:opacity-60">
                {agents.discovery === 'running' ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}Run discovery
              </button>
            ) : undefined}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={<SearchX />} title="No events match" description={hiddenTools ? 'Try clearing a filter, or show terraform output — matching lines may be hidden.' : 'Try clearing a filter, or run an agent from the command palette (Ctrl K) to generate new events.'} />
        ) : (
          <>
            <ol className="divide-y" aria-label="Event log">
              <AnimatePresence initial={false}>
                {rows.slice(0, PAGE).map(e => {
                  const expanded = open === e.id
                  const hasDetail = Object.keys(e.payload).length > 0
                  return (
                    <motion.li key={e.id} layout="position" initial={{ opacity: 0, backgroundColor: 'color-mix(in oklch, var(--primary) 12%, transparent)' }} animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }} transition={{ duration: 0.8 }}>
                      <button
                        onClick={() => hasDetail && setOpen(expanded ? null : e.id)}
                        aria-expanded={hasDetail ? expanded : undefined}
                        className={cn('grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 px-4 py-3 text-left sm:grid-cols-[88px_170px_1fr_auto]', hasDetail && 'cursor-pointer hover:bg-surface-2')}
                      >
                        <span className="font-mono text-[11px] text-subtle tabular">{timeOf(e.ts)}</span>
                        <span className="flex items-center gap-1.5">
                          <ChevronRight className={cn('size-3.5 text-subtle transition', expanded && 'rotate-90', !hasDetail && 'invisible')} />
                          <span className={cn('size-1.5 rounded-full', LEVEL_DOT[e.level])} />
                          <span className={cn('font-mono text-[11.5px] font-medium', LEVEL_TEXT[e.level])}>{e.type}</span>
                        </span>
                        <span className={cn('col-span-2 min-w-0 text-[13px] text-foreground sm:col-span-1', isToolOutput(e) && 'break-all font-mono text-[11.5px] text-muted-foreground')}>
                          {e.summary}
                          {e.app_id && <span className="ml-2 font-mono text-[11px] text-subtle">{e.app_id}</span>}
                        </span>
                        <span className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
                          <Badge tone="neutral" className="text-[10px]">{e.agent === 'orchestrator' ? <User className="size-3" /> : null}{e.agent}</Badge>
                          <DecidedBy by={e.decided_by} />
                        </span>
                      </button>
                      <AnimatePresence initial={false}>
                        {expanded && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="px-4 pb-4 sm:pl-[118px]">
                              <pre className="code-block scrollbar-thin overflow-x-auto p-3 text-[11.5px] leading-5 text-muted-foreground">{JSON.stringify({ id: e.id, ts: e.ts, agent: e.agent, app_id: e.app_id, type: e.type, level: e.level, decided_by: e.decided_by, payload: e.payload }, null, 2)}</pre>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ol>
            {rows.length > PAGE && (
              <div className="border-t px-4 py-3 text-center text-xs text-subtle">Showing the newest {PAGE} of {rows.length.toLocaleString()} matching events — export JSON for the full set.</div>
            )}
          </>
        )}
      </Card>
    </>
  )
}
