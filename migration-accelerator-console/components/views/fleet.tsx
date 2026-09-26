'use client'

import { Dialog } from '@base-ui/react/dialog'
import { motion } from 'framer-motion'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, GitBranch, Loader2, Radar, Search, SearchX, ShieldCheck, WifiOff, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { FindingCode, Tier } from '@/lib/contracts'
import { FINDING_CODES } from '@/lib/contracts'
import { EDGE_SIGNAL_LABEL, FINDING_META, type FleetApp } from '@/lib/meta'
import { cn } from '@/lib/utils'
import { FindingChip, PageHeader, Reveal, SourceBadge, StatCard, StatusBadge, TIER_COLOR_VAR, TIER_LABEL, TierBadge } from '@/components/console/bits'
import { ChartTooltip, axisProps } from '@/components/console/charts'
import { useConsole } from '@/components/console/console-provider'
import { Badge, Card, CardHeader, EmptyState, Input, Segmented, Skeleton } from '@/components/ui/primitives'

type SortKey = 'app_id' | 'name' | 'owner' | 'business_unit' | 'tier' | 'score' | 'findings'
const TIERS: Tier[] = ['GOLDEN', 'GRAY', 'RED']
const TIER_ORDER: Record<Tier, number> = { GOLDEN: 0, GRAY: 1, RED: 2 }
const TIER_HINT: Record<Tier, string> = { GOLDEN: 'Flows through untouched', GRAY: 'One human approval', RED: 'Parked for engineering' }

function useParamState() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false })
  }
  return { params, set }
}

function DiscoveryButton({ label }: { label: string }) {
  const { agents, runDiscovery, online } = useConsole()
  const running = agents.discovery === 'running'
  return (
    <button onClick={() => { void runDiscovery() }} disabled={running || !online} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-elev-1 transition hover:brightness-110 disabled:opacity-60">
      {running ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}{running ? 'Scanning…' : label}
    </button>
  )
}

// Live discovery status: the agent state says "running"; the count is the APP_DISCOVERED
// events that arrived since the most recent DISCOVERY_STARTED (events are newest first).
function DiscoveryBanner() {
  const { agents, events } = useConsole()
  const reported = useMemo(() => {
    let n = 0
    for (const e of events) {
      if (e.type === 'DISCOVERY_STARTED') break
      if (e.type !== 'APP_DISCOVERED') continue
      const ids = e.payload?.app_ids
      n += Array.isArray(ids) ? ids.length : 1
    }
    return n
  }, [events])
  if (agents.discovery !== 'running') return null
  return (
    <div className="surface mb-4 flex items-center gap-4 p-4" role="status" aria-live="polite">
      <Loader2 className="size-4 animate-spin text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">Scanning Account A via mig-discovery-readonly, then ingesting the synthetic fleet…</div>
        <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <motion.div className="absolute inset-y-0 w-1/3 rounded-full bg-primary" initial={{ x: '-100%' }} animate={{ x: '300%' }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} />
        </div>
      </div>
      <span className="font-mono text-xs text-subtle tabular">{reported ? `${reported.toLocaleString()} apps reported` : 'waiting for results'}</span>
    </div>
  )
}

function AppDrawer({ app, onClose }: { app: FleetApp | null; onClose: () => void }) {
  const { statuses, edges } = useConsole()
  const out = app ? edges.filter(e => e.from === app.app_id) : []
  const inc = app ? edges.filter(e => e.to === app.app_id) : []
  return (
    <Dialog.Root open={!!app} onOpenChange={o => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-y-2 right-2 z-50 flex w-[min(480px,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border bg-popover shadow-elev-3 outline-none transition-[transform,opacity] duration-200 data-[ending-style]:translate-x-6 data-[ending-style]:opacity-0 data-[starting-style]:translate-x-6 data-[starting-style]:opacity-0">
          {app && (
            <>
              <div className="flex items-start gap-3 border-b p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="font-mono text-xs text-muted-foreground">{app.app_id}</span><SourceBadge source={app.source} /></div>
                  <Dialog.Title className="mt-1 text-lg font-semibold tracking-tight">{app.name}</Dialog.Title>
                  <Dialog.Description className="mt-0.5 text-[13px] text-muted-foreground">{app.owner ?? "no owner tag"} · {app.business_unit ?? "no business-unit tag"} · {app.runtime.type.toUpperCase()} {app.runtime.instance_type}</Dialog.Description>
                </div>
                <Dialog.Close className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground" aria-label="Close details"><X className="size-4" /></Dialog.Close>
              </div>
              <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Tier</div><div className="mt-1.5"><TierBadge tier={app.tier} /></div></div>
                  <div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Score</div><div className="mt-1 text-xl font-semibold tabular">{app.score}</div></div>
                  <div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Status</div><div className="mt-1.5"><StatusBadge status={statuses[app.app_id] ?? app.status} /></div></div>
                </div>
                <div className="mt-5 rounded-xl border bg-surface-2/60 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium">Risk summary <Badge tone={app.tiering.decided_by === 'llm' ? 'brand' : 'neutral'} className="text-[10px]">decided by {app.tiering.decided_by === 'llm' ? 'LLM' : 'rules'}</Badge></div>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">{app.tiering.risk_summary}</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">{app.tiering.reasons.map(r => <li key={r}><Badge tone="neutral" className="text-[10.5px]">{r}</Badge></li>)}</ul>
                </div>
                <h4 className="mt-6 text-xs font-semibold uppercase tracking-wider text-subtle">Findings · {app.findings.length}</h4>
                <ul className="mt-2 flex flex-col gap-2">
                  {app.findings.map(f => (
                    <li key={f} className="flex items-start gap-3 rounded-lg border p-3">
                      <span className={cn('mt-1 size-2 shrink-0 rounded-full', FINDING_META[f].severity === 'critical' ? 'bg-destructive' : FINDING_META[f].severity === 'high' ? 'bg-warning' : 'bg-subtle')} />
                      <div className="min-w-0"><div className="font-mono text-[11.5px] font-medium">{f}</div><div className="mt-0.5 text-xs text-muted-foreground">{f === 'STATEFUL' ? '' : 'Fix: '}{FINDING_META[f].fix}</div></div>
                    </li>
                  ))}
                  {!app.findings.length && <li className="text-sm text-muted-foreground">No findings — already compliant.</li>}
                </ul>
                <h4 className="mt-6 text-xs font-semibold uppercase tracking-wider text-subtle">Dependencies</h4>
                <ul className="mt-2 flex flex-col gap-2">
                  {out.map(e => <li key={e.to} className="rounded-lg border p-3 text-[13px]"><span className="text-muted-foreground">calls</span> <span className="font-mono text-xs">{e.to}</span><div className="mt-1 text-xs text-subtle">found via {e.signals.map(s => EDGE_SIGNAL_LABEL[s]).join(' · ')}</div></li>)}
                  {inc.slice(0, 5).map(e => <li key={e.from} className="rounded-lg border p-3 text-[13px]"><span className="text-muted-foreground">called by</span> <span className="font-mono text-xs">{e.from}</span></li>)}
                  {inc.length > 5 && <li className="text-xs text-subtle">+{inc.length - 5} more consumers</li>}
                  {!out.length && !inc.length && <li className="text-sm text-muted-foreground">No dependencies discovered.</li>}
                </ul>
                {Object.keys(app.config.env).length > 0 && (
                  <>
                    <h4 className="mt-6 text-xs font-semibold uppercase tracking-wider text-subtle">Config</h4>
                    <pre className="code-block mt-2 overflow-x-auto p-3 text-[11.5px] leading-5">{Object.entries(app.config.env).map(([k, v]) => `${k}=${v}`).join('\n')}</pre>
                  </>
                )}
              </div>
              {app.source === 'real' && (
                <div className="flex gap-2 border-t p-4">
                  <Link href={`/blueprint?app=${app.app_id}`} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground"><ShieldCheck className="size-4" />Open blueprint</Link>
                  <Link href="/dependencies" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium"><GitBranch className="size-4" />Graph</Link>
                </div>
              )}
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function FleetView() {
  const { params, set } = useParamState()
  const { fleet, loading, online, error } = useConsole()
  const q = params.get('q') ?? ''
  const tier = (params.get('tier') ?? 'all') as Tier | 'all'
  const source = (params.get('source') ?? 'all') as 'all' | 'real' | 'synthetic'
  const finding = params.get('finding') as FindingCode | null
  const bu = params.get('bu')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState<FleetApp | null>(null)
  const [search, setSearch] = useState(q)
  useEffect(() => setSearch(q), [q])
  useEffect(() => { const t = setTimeout(() => { if (search !== q) set({ q: search || null }) }, 200); return () => clearTimeout(t) }, [search]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPage(0), [q, tier, source, finding, bu, pageSize])

  const filtered = useMemo(() => {
    const needle = q.toLowerCase()
    const rows = fleet.filter(a =>
      (tier === 'all' || a.tier === tier) && (source === 'all' || a.source === source) && (!finding || a.findings.includes(finding)) &&
      (!bu || (a.business_unit ?? "").toLowerCase() === bu.toLowerCase()) &&
      (!needle || `${a.app_id} ${a.name} ${a.owner ?? ""} ${a.business_unit ?? ""}`.toLowerCase().includes(needle)))
    const val = (a: FleetApp) => sort.key === 'tier' ? TIER_ORDER[a.tier] : sort.key === 'findings' ? a.findings.length : sort.key === 'score' ? a.score : a[sort.key]
    return rows.sort((a, b) => {
      if (a.source !== b.source && sort.key === 'score' && sort.dir === -1) return a.source === 'real' ? -1 : 1 // live apps pinned on the default view
      const x = val(a), y = val(b)
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
  }, [fleet, q, tier, source, finding, bu, sort])

  const stats = useMemo(() => {
    const tiers = { GOLDEN: 0, GRAY: 0, RED: 0 } as Record<Tier, number>
    const tiersReal = { GOLDEN: 0, GRAY: 0, RED: 0 } as Record<Tier, number>
    let real = 0
    for (const a of fleet) { tiers[a.tier]++; if (a.source === 'real') { real++; tiersReal[a.tier]++ } }
    return { tiers, tiersReal, real, synthetic: fleet.length - real }
  }, [fleet])
  const units = useMemo(() => [...new Set(fleet.map(a => a.business_unit).filter((b): b is string => !!b))].sort((a, b) => a.localeCompare(b)), [fleet])
  const findingData = useMemo(() => {
    const c = new Map<FindingCode, number>()
    for (const a of fleet) for (const f of a.findings) c.set(f, (c.get(f) ?? 0) + 1)
    return FINDING_CODES.map(code => ({ code, name: code, value: c.get(code) ?? 0 })).filter(d => d.value > 0).sort((a, b) => b.value - a.value)
  }, [fleet])
  const pct = (n: number) => (fleet.length ? Math.round((n / fleet.length) * 100) : 0)
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const rows = filtered.slice(page * pageSize, page * pageSize + pageSize)

  const exportCsv = () => {
    const head = ['app_id', 'name', 'source', 'owner', 'business_unit', 'tier', 'score', 'decided_by', 'findings']
    const lines = filtered.map(a => [a.app_id, a.name, a.source, a.owner ?? "", a.business_unit ?? "", a.tier, a.score, a.tiering.decided_by, a.findings.join(' ')].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }))
    Object.assign(document.createElement('a'), { href: url, download: `fleet-${filtered.length}.csv` }).click()
    URL.revokeObjectURL(url)
  }

  const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th scope="col" aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('sticky top-0 z-10 border-b bg-surface-2/95 px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-subtle backdrop-blur', className)}>
      <button onClick={() => setSort(s => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === 'score' || k === 'findings' ? -1 : 1 }))} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}{sort.key === k ? (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </th>
  )
  const active = [tier !== 'all' && `tier: ${tier}`, source !== 'all' && `source: ${source}`, finding && `finding: ${finding}`, bu && `unit: ${bu}`, q && `“${q}”`].filter(Boolean) as string[]
  const clearAll = () => { setSearch(''); set({ q: null, tier: null, source: null, finding: null, bu: null }) }

  const empty = !loading && fleet.length === 0
  const description = fleet.length
    ? `Everything Discovery found — ${stats.real.toLocaleString()} live ${stats.real === 1 ? 'app' : 'apps'} in Account A and ${stats.synthetic.toLocaleString()} synthetic ${stats.synthetic === 1 ? 'app' : 'apps'}, scored by the same finding and tiering rules.`
    : 'Everything Discovery finds — the live apps in Account A plus the synthetic fleet, scored by the same finding and tiering rules.'

  return (
    <>
      <PageHeader
        eyebrow="Discover"
        title="Application fleet"
        description={description}
        actions={<>
          <DiscoveryButton label={fleet.length ? 'Re-run discovery' : 'Run discovery'} />
          <button onClick={exportCsv} disabled={!filtered.length} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-medium transition hover:border-border-strong disabled:opacity-50"><Download className="size-4" />Export CSV</button>
        </>}
      />
      <DiscoveryBanner />

      {empty ? (
        <Card>
          {online ? (
            <EmptyState icon={<Radar />} title="No apps discovered yet" description="Run discovery to scan Account A with the read-only role and load the synthetic fleet. Every app is scored and tiered as it lands." action={<DiscoveryButton label="Run discovery" />} />
          ) : (
            <EmptyState icon={<WifiOff />} title="Orchestrator unreachable" description={error ?? 'The console reconnects automatically once the orchestrator is back.'} />
          )}
        </Card>
      ) : (
        <>
          <Reveal className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {TIERS.map(t => (
              <button key={t} onClick={() => set({ tier: tier === t ? null : t })} className={cn('rounded-xl text-left outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring', tier === t && 'ring-2 ring-primary/60')} aria-pressed={tier === t}>
                <StatCard
                  label={`${TIER_LABEL[t]} tier`}
                  value={loading ? '—' : stats.tiers[t]}
                  trendLabel={fleet.length ? `${pct(stats.tiers[t])}%` : undefined}
                  trend="flat"
                  hint={
                    <>
                      <span>{TIER_HINT[t]}{stats.tiersReal[t] ? ` · ${stats.tiersReal[t]} live` : ''}</span>
                      <span className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                        <motion.span className="block h-full rounded-full" style={{ background: TIER_COLOR_VAR[t] }} initial={{ width: 0 }} animate={{ width: `${pct(stats.tiers[t])}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
                      </span>
                    </>
                  }
                />
              </button>
            ))}
          </Reveal>

          <Card className="mt-4">
            <CardHeader title="Finding coverage" description="Apps affected per finding code — click a bar to filter the table" action={finding && <button onClick={() => set({ finding: null })} className="text-xs font-medium text-primary">Clear finding</button>} />
            <div className="h-56 px-3 pb-3 pt-2">
              {loading ? <Skeleton className="h-full" /> : findingData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No findings across the fleet.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={findingData} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="code" width={150} {...axisProps} tick={{ ...axisProps.tick, fontFamily: 'var(--font-mono)', fontSize: 10.5 }} />
                    <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip formatter={v => `${v} apps · ${pct(Number(v))}%`} />} />
                    <Bar dataKey="value" name="Apps" radius={[0, 4, 4, 0]} barSize={12} onClick={d => { const code = (d as { payload?: { code?: string } }).payload?.code; if (code) set({ finding: finding === code ? null : code }) }} className="cursor-pointer" isAnimationActive={false}>
                      {findingData.map(d => <Cell key={d.code} fill={!finding || finding === d.code ? (FINDING_META[d.code].severity === 'critical' ? 'var(--destructive)' : FINDING_META[d.code].severity === 'high' ? 'var(--warning)' : 'var(--primary)') : 'var(--border-strong)'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card className="mt-4 overflow-hidden">
            <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center">
              <Input icon={<Search />} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search id, name, owner, business unit…" aria-label="Search applications" className="xl:w-80" />
              <div className="flex flex-wrap items-center gap-2">
                <Segmented label="Source" size="sm" value={source} onChange={v => set({ source: v === 'all' ? null : v })} options={[{ value: 'all', label: 'All' }, { value: 'real', label: 'Live' }, { value: 'synthetic', label: 'Synthetic' }]} />
                <select aria-label="Filter by finding" value={finding ?? ''} onChange={e => set({ finding: e.target.value || null })} className="h-8 rounded-lg border bg-card px-2 text-xs">
                  <option value="">Any finding</option>{FINDING_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select aria-label="Filter by business unit" value={bu ?? ''} onChange={e => set({ bu: e.target.value || null })} className="h-8 rounded-lg border bg-card px-2 text-xs">
                  <option value="">Any unit</option>{units.map(b => <option key={b} value={b.toLowerCase()}>{b}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 xl:ml-auto">
                {active.map(a => <Badge key={a} tone="brand">{a}</Badge>)}
                {active.length > 0 && <button onClick={clearAll} className="text-xs font-medium text-muted-foreground hover:text-foreground">Clear all</button>}
              </div>
            </div>
            <div className="scrollbar-thin max-h-[640px] overflow-auto">
              {loading ? (
                <div className="flex flex-col gap-3 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
              ) : rows.length === 0 ? (
                <EmptyState icon={<SearchX />} title="No apps match these filters" description={`Loosen a filter or clear the search to see the full fleet of ${fleet.length.toLocaleString()} apps.`} action={<button onClick={clearAll} className="rounded-lg border px-3 py-1.5 text-xs font-medium">Clear filters</button>} />
              ) : (
                <table className="w-full min-w-[920px] border-separate border-spacing-0 text-[13px]">
                  <caption className="sr-only">Discovered applications</caption>
                  <thead>
                    <tr>
                      <SortHead k="app_id">App</SortHead>
                      <SortHead k="name">Name</SortHead>
                      <SortHead k="owner">Owner</SortHead>
                      <SortHead k="business_unit">Unit</SortHead>
                      <SortHead k="tier">Tier</SortHead>
                      <SortHead k="score" className="text-right">Score</SortHead>
                      <SortHead k="findings">Findings</SortHead>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(a => (
                      <tr key={a.app_id} onClick={() => setSelected(a)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(a) } }} tabIndex={0} className="group cursor-pointer outline-none transition hover:bg-surface-2 focus-visible:bg-surface-2">
                        <td className="border-b px-4 py-2.5"><div className="flex items-center gap-2"><span className="font-mono text-xs">{a.app_id}</span>{a.source === 'real' && <SourceBadge source="real" />}</div></td>
                        <td className="border-b px-4 py-2.5 font-medium">{a.name}</td>
                        <td className="border-b px-4 py-2.5 text-muted-foreground">{a.owner ?? "—"}</td>
                        <td className="border-b px-4 py-2.5 text-muted-foreground">{a.business_unit ?? "—"}</td>
                        <td className="border-b px-4 py-2.5"><div className="flex items-center gap-1.5"><TierBadge tier={a.tier} />{a.tiering.decided_by === 'llm' && <Badge tone="brand" className="px-1.5 text-[10px]">AI</Badge>}</div></td>
                        <td className="border-b px-4 py-2.5 text-right"><span className={cn('tabular font-medium', a.score < 40 ? 'text-red-tier' : a.score < 75 ? 'text-gray-tier' : '')}>{a.score}</span></td>
                        <td className="border-b px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            {a.findings.slice(0, 2).map(f => <FindingChip key={f} code={f} />)}
                            {a.findings.length > 2 && <span className="text-xs text-subtle">+{a.findings.length - 2}</span>}
                            <ChevronRight className="ml-auto size-4 text-subtle opacity-0 transition group-hover:opacity-100" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
              <span className="tabular">{filtered.length ? `${page * pageSize + 1}–${Math.min(filtered.length, (page + 1) * pageSize)} of ${filtered.length.toLocaleString()}` : '0 results'}</span>
              <label className="ml-auto flex items-center gap-2">Rows
                <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-7 rounded-md border bg-card px-1.5">{[25, 50, 100].map(n => <option key={n}>{n}</option>)}</select>
              </label>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="flex size-7 items-center justify-center rounded-md border disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="size-4" /></button>
                <span className="px-2 tabular">{page + 1} / {pages}</span>
                <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className="flex size-7 items-center justify-center rounded-md border disabled:opacity-40" aria-label="Next page"><ChevronRight className="size-4" /></button>
              </div>
            </div>
          </Card>
        </>
      )}
      <AppDrawer app={selected} onClose={() => setSelected(null)} />
    </>
  )
}
