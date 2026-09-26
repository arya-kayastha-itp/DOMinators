'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Crosshair, Loader2, Move3d, X } from 'lucide-react'
import { useTheme } from 'next-themes'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { EDGE_SIGNAL_LABEL, REAL_APP_IDS, edges, fleet, fleetById, type FleetApp } from '@/lib/data/fleet'
import { FindingChip, PageHeader, SourceBadge, TIER_COLOR_VAR, TierBadge } from '@/components/console/bits'
import { Badge, Card, Segmented } from '@/components/ui/primitives'
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

// Fleet sample: the most-connected hubs plus their direct consumers — enough structure to
// read, cheap enough to render as individual meshes (see the InstancedMesh note in the graph).
function fleetSample(): FleetApp[] {
  const degree = new Map<string, number>()
  for (const e of edges) { degree.set(e.to, (degree.get(e.to) ?? 0) + 1); degree.set(e.from, (degree.get(e.from) ?? 0) + 1) }
  const hubs = [...degree.entries()].filter(([id]) => id.startsWith('syn')).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([id]) => id)
  const ids = new Set<string>([...REAL_APP_IDS, ...hubs])
  for (const e of edges) if (hubs.includes(e.to) && ids.size < 84) ids.add(e.from)
  return [...ids].map(id => fleetById.get(id)!).filter(Boolean)
}

function neighborhood(id: string, hops = 2): FleetApp[] {
  const ids = new Set([id])
  let frontier = [id]
  for (let h = 0; h < hops; h++) {
    const next: string[] = []
    for (const e of edges) {
      if (frontier.includes(e.from) && !ids.has(e.to)) { ids.add(e.to); next.push(e.to) }
      if (frontier.includes(e.to) && !ids.has(e.from) && ids.size < 80) { ids.add(e.from); next.push(e.from) }
    }
    frontier = next
  }
  return [...ids].map(x => fleetById.get(x)!).filter(Boolean)
}

export function DependenciesView() {
  const [view, setView] = useState<View>('sample')
  const [selected, setSelected] = useState<FleetApp | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = !mounted || resolvedTheme !== 'light'

  const sample = useMemo(fleetSample, [])
  const apps = useMemo<FleetApp[]>(() => {
    if (view === 'live') return REAL_APP_IDS.map(id => fleetById.get(id)!)
    if (view === 'focus' && focusId) return neighborhood(focusId)
    return sample
  }, [view, focusId, sample])
  const foreground = view === 'focus' && focusId && !focusId.startsWith('app-') ? [focusId] : REAL_APP_IDS
  const visibleEdges = useMemo(() => { const s = new Set(apps.map(a => a.app_id)); return edges.filter(e => s.has(e.from) && s.has(e.to)).length }, [apps])

  const out = selected ? edges.filter(e => e.from === selected.app_id) : []
  const inc = selected ? edges.filter(e => e.to === selected.app_id) : []

  return (
    <>
      <PageHeader
        eyebrow="Discover"
        title="Dependency topology"
        description="Edges come from three independent signals — depends-on tags, SSM values holding a provider's IP, and security-group references — unioned per pair."
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
        <Badge tone="neutral">{visibleEdges} edges</Badge>
        <span className="hidden sm:inline">of {fleet.length.toLocaleString()} apps · {edges.length.toLocaleString()} edges fleet-wide</span>
        <span className="ml-auto flex items-center gap-1.5"><Move3d className="size-3.5" /> Drag to orbit · scroll to zoom · click a node</span>
      </div>
      <Card className="relative overflow-hidden p-0" style={{ height: 'min(72vh, 680px)' }}>
        <DependencyGraph3D key={`${view}-${focusId}`} apps={apps as GraphApp[]} foregroundIds={foreground} onSelect={a => setSelected(a ? fleetById.get(a.app_id) ?? null : null)} selectedId={selected?.app_id ?? null} dark={dark} />

        <div className="glass pointer-events-none absolute left-4 top-4 rounded-xl border px-3 py-2.5 shadow-elev-1">
          <div className="eyebrow">Legend</div>
          <ul className="mt-1.5 flex flex-col gap-1 text-[11.5px]">
            {[['Golden', TIER_COLOR_VAR.GOLDEN], ['Gray', TIER_COLOR_VAR.GRAY], ['Red', TIER_COLOR_VAR.RED], ['Target platform', 'var(--target)']].map(([l, c]) => (
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
                  <div className="mt-2 flex items-center gap-2"><TierBadge tier={selected.tier} /><span className="text-xs text-muted-foreground">score {selected.score}</span></div>
                </div>
                <button onClick={() => setSelected(null)} className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground" aria-label="Close details"><X className="size-4" /></button>
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
                <div className="eyebrow mt-4">Findings</div>
                <div className="mt-2 flex flex-wrap gap-1">{selected.findings.map(f => <FindingChip key={f} code={f} />)}</div>
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
        <summary className="cursor-pointer font-medium">Edge list ({visibleEdges}) — accessible view</summary>
        <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {edges.filter(e => apps.some(a => a.app_id === e.from) && apps.some(a => a.app_id === e.to)).slice(0, 120).map(e => (
            <li key={`${e.from}-${e.to}`} className="font-mono text-xs text-muted-foreground">{e.from} → {e.to} <span className="text-subtle">({e.signals.join(', ')})</span></li>
          ))}
        </ul>
      </details>
    </>
  )
}
