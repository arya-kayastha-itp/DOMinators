'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Crosshair, Loader2, Move3d, Radar, WifiOff, X } from 'lucide-react'
import { useTheme } from 'next-themes'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { Edge, EdgeSignal } from '@/lib/contracts'
import { EDGE_SIGNAL_LABEL, type FleetApp } from '@/lib/meta'
import { FindingChip, PageHeader, SourceBadge, StatusBadge, TIER_COLOR_VAR, TierBadge } from '@/components/console/bits'
import { useConsole } from '@/components/console/console-provider'
import { Badge, Card, EmptyState, Segmented, Skeleton } from '@/components/ui/primitives'
import type { GraphApp } from '@/components/dependency-graph-3d'

const DependencyGraph3D = dynamic(() => import('@/components/dependency-graph-3d'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex items-center gap-3 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" /> Building topology…</div>
    </div>
  ),
})

type View = 'live' | 'sample' | 'focus'

// Rendering budget: nodes are individual meshes (see the InstancedMesh note in the graph).
const SAMPLE_HUBS = 14
const MAX_NODES = 84
const FOCUS_MAX = 80

// Fleet sample: the live apps, the most-connected synthetic hubs and their direct consumers.
function fleetSample(edges: Edge[], fleetById: Map<string, FleetApp>, realIds: string[]): FleetApp[] {
  const degree = new Map<string, number>()
  for (const e of edges) { degree.set(e.to, (degree.get(e.to) ?? 0) + 1); degree.set(e.from, (degree.get(e.from) ?? 0) + 1) }
  const hubs = [...degree.entries()].filter(([id]) => fleetById.get(id)?.source === 'synthetic').sort((a, b) => b[1] - a[1]).slice(0, SAMPLE_HUBS).map(([id]) => id)
  const hubSet = new Set(hubs)
  const ids = new Set<string>([...realIds, ...hubs])
  for (const e of edges) if (hubSet.has(e.to) && ids.size < MAX_NODES) ids.add(e.from)
  return [...ids].map(id => fleetById.get(id)).filter((a): a is FleetApp => !!a)
}

function neighborhood(id: string, edges: Edge[], fleetById: Map<string, FleetApp>, hops = 2): FleetApp[] {
  const ids = new Set([id])
  let frontier = new Set([id])
  for (let h = 0; h < hops; h++) {
    const next = new Set<string>()
    for (const e of edges) {
      if (frontier.has(e.from) && !ids.has(e.to)) { ids.add(e.to); next.add(e.to) }
      if (frontier.has(e.to) && !ids.has(e.from) && ids.size < FOCUS_MAX) { ids.add(e.from); next.add(e.from) }
    }
    frontier = next
  }
  return [...ids].map(x => fleetById.get(x)).filter((a): a is FleetApp => !!a)
}

export function DependenciesView() {
  const { fleet, fleetById, edges, realAppIds, statuses, plan, loading, online, agents, runDiscovery } = useConsole()
  const [view, setView] = useState<View>('sample')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = !mounted || resolvedTheme !== 'light'
  const selected = selectedId ? fleetById.get(selectedId) ?? null : null

  // The graph draws its lines from depends_on; feed it the discovered edges (consumer → provider)
  // so every signal (tags, SSM, env, SG refs, flow logs) shows up, not just the tag.
  const dependsOn = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of edges) { const l = m.get(e.from); if (l) l.push(e.to); else m.set(e.from, [e.to]) }
    return m
  }, [edges])

  // Live chain order: Wave 0 order when a plan exists (providers first), then any other live app.
  const liveChain = useMemo(() => {
    const real = new Set(realAppIds)
    const first = (plan?.waves[0]?.app_ids ?? []).filter(id => real.has(id))
    return [...first, ...realAppIds.filter(id => !first.includes(id))]
  }, [plan, realAppIds])

  const sample = useMemo(() => fleetSample(edges, fleetById, liveChain), [edges, fleetById, liveChain])
  const apps = useMemo<FleetApp[]>(() => {
    if (view === 'live') return liveChain.map(id => fleetById.get(id)).filter((a): a is FleetApp => !!a)
    if (view === 'focus' && focusId) return neighborhood(focusId, edges, fleetById)
    return sample
  }, [view, focusId, sample, liveChain, edges, fleetById])
  const graphApps = useMemo<GraphApp[]>(() => apps.map(a => ({ app_id: a.app_id, name: a.name, tier: a.tier, source: a.source, depends_on: dependsOn.get(a.app_id) ?? [] })), [apps, dependsOn])
  const foreground = useMemo(() => (view === 'focus' && focusId && fleetById.get(focusId)?.source !== 'real' ? [focusId] : liveChain), [view, focusId, fleetById, liveChain])

  const visible = useMemo(() => { const s = new Set(apps.map(a => a.app_id)); return edges.filter(e => s.has(e.from) && s.has(e.to)) }, [apps, edges])
  const migratedIds = useMemo(() => new Set(apps.filter(a => statuses[a.app_id] === 'MIGRATED').map(a => a.app_id)), [apps, statuses])
  const signalsSeen = useMemo(() => {
    const s = new Set<EdgeSignal>()
    for (const e of edges) for (const sg of e.signals) if (sg !== 'synthetic') s.add(sg)
    return [...s]
  }, [edges])
  const realEdges = useMemo(() => edges.filter(e => e.source === 'real').length, [edges])

  const out = selected ? edges.filter(e => e.from === selected.app_id) : []
  const inc = selected ? edges.filter(e => e.to === selected.app_id) : []

  const description = signalsSeen.length
    ? `Edges come from independent signals — ${signalsSeen.map(s => EDGE_SIGNAL_LABEL[s]).join(', ')} — unioned per pair.`
    : 'Edges come from independent signals — depends-on tags, SSM values holding a provider’s IP, security-group references — unioned per pair.'

  if (!loading && fleet.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Discover" title="Dependency topology" description={description} />
        <Card>
          {online ? (
            <EmptyState
              icon={<Radar />}
              title="No topology yet"
              description="Dependencies are discovered alongside the fleet. Run discovery to map who calls whom."
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

  return (
    <>
      <PageHeader
        eyebrow="Discover"
        title="Dependency topology"
        description={description}
        actions={
          <Segmented<View>
            label="Graph view"
            value={view}
            onChange={v => { setView(v); if (v !== 'focus') setFocusId(null) }}
            options={[{ value: 'live', label: 'Live chain' }, { value: 'sample', label: 'Fleet sample' }, ...(focusId ? [{ value: 'focus' as View, label: `Focus ${focusId}` }] : [])]}
          />
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge tone="neutral">{apps.length} nodes</Badge>
        <Badge tone="neutral">{visible.length} edges</Badge>
        {migratedIds.size > 0 && <Badge tone="success">{migratedIds.size} migrated</Badge>}
        <span className="hidden sm:inline">of {fleet.length.toLocaleString()} apps · {edges.length.toLocaleString()} edges fleet-wide · {realEdges.toLocaleString()} among live apps</span>
        <span className="ml-auto flex items-center gap-1.5"><Move3d className="size-3.5" /> Drag to orbit · scroll to zoom · click a node</span>
      </div>
      <Card className="relative overflow-hidden p-0" style={{ height: 'min(72vh, 680px)' }}>
        {loading ? <Skeleton className="absolute inset-0 rounded-none" /> : (
          <DependencyGraph3D key={`${view}-${focusId}`} apps={graphApps} foregroundIds={foreground} migratedIds={migratedIds} onSelect={a => setSelectedId(a && fleetById.has(a.app_id) ? a.app_id : null)} selectedId={selectedId} dark={dark} />
        )}

        <div className="glass pointer-events-none absolute left-4 top-4 rounded-xl border px-3 py-2.5 shadow-elev-1">
          <div className="eyebrow">Legend</div>
          <ul className="mt-1.5 flex flex-col gap-1 text-[11.5px]">
            {[['Golden', TIER_COLOR_VAR.GOLDEN], ['Gray', TIER_COLOR_VAR.GRAY], ['Red', TIER_COLOR_VAR.RED], ['Target platform / migrated', 'var(--target)']].map(([l, c]) => (
              <li key={l} className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: c }} />{l}</li>
            ))}
          </ul>
        </div>

        <AnimatePresence>
          {selected && (
            <motion.aside key={selected.app_id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.2 }} className="glass absolute bottom-4 right-4 top-4 flex w-[min(340px,calc(100%-2rem))] flex-col overflow-hidden rounded-xl border shadow-elev-3" aria-label={`${selected.app_id} details`}>
              <div className="flex items-start gap-2 border-b p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="font-mono text-xs text-muted-foreground">{selected.app_id}</span><SourceBadge source={selected.source} /></div>
                  <h3 className="mt-1 font-semibold">{selected.name}</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2"><TierBadge tier={selected.tier} /><StatusBadge status={statuses[selected.app_id] ?? selected.status} /><span className="text-xs text-muted-foreground">score {selected.score}</span></div>
                </div>
                <button onClick={() => setSelectedId(null)} className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground" aria-label="Close details"><X className="size-4" /></button>
              </div>
              <div className="scrollbar-thin flex-1 overflow-y-auto p-4 text-[13px]">
                <div className="eyebrow">Calls</div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {out.length ? out.map(e => (
                    <li key={e.to} className="rounded-lg border bg-card/60 p-2.5">
                      <span className="font-mono text-xs">{e.to}</span>
                      <div className="mt-1 flex flex-wrap gap-1">{e.signals.map(sg => <Badge key={sg} tone="brand" className="text-[10px]">{EDGE_SIGNAL_LABEL[sg]}</Badge>)}</div>
                    </li>
                  )) : <li className="text-xs text-muted-foreground">No upstream dependencies</li>}
                </ul>
                <div className="eyebrow mt-4">Called by · {inc.length}</div>
                <ul className="mt-2 flex flex-wrap gap-1">{inc.slice(0, 12).map(e => <li key={e.from}><Badge tone="neutral" className="font-mono text-[10px]">{e.from}</Badge></li>)}</ul>
                {inc.length > 12 && <p className="mt-1 text-xs text-subtle">+{inc.length - 12} more</p>}
                <div className="eyebrow mt-4">Findings</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {selected.findings.length ? selected.findings.map(f => <FindingChip key={f} code={f} />) : <span className="text-xs text-muted-foreground">None — already compliant</span>}
                </div>
              </div>
              <div className="flex gap-2 border-t p-3">
                <button onClick={() => { setFocusId(selected.app_id); setView('focus') }} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border bg-card text-xs font-medium transition hover:border-border-strong"><Crosshair className="size-3.5" />Focus 2-hop</button>
                <Link href={`/fleet?q=${selected.app_id}`} className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-primary text-xs font-medium text-primary-foreground">Open in fleet</Link>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </Card>

      {/* Non-visual alternative to the WebGL canvas: the same edges as a list. */}
      <details className="surface mt-4 p-4 text-[13px]">
        <summary className="cursor-pointer font-medium">Edge list ({visible.length}) — accessible view</summary>
        <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.slice(0, 120).map(e => (
            <li key={`${e.from}-${e.to}`} className="font-mono text-xs text-muted-foreground">{e.from} → {e.to} <span className="text-subtle">({e.signals.join(', ')})</span></li>
          ))}
        </ul>
        {visible.length > 120 && <p className="mt-2 text-xs text-subtle">Showing 120 of {visible.length} edges.</p>}
      </details>
    </>
  )
}
