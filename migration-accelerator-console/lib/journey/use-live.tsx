'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api, type DemoState, type Summary } from '@/lib/api'
import { liveStages } from './pipeline'

// ---------------------------------------------------------------------------
// Live numbers for /journey, read from the orchestrator (GET /summary and
// GET /demo/state). One fetch on mount, then every 15 s while the tab is
// visible. `online` is null until the first answer (or failure) arrives, so
// nothing flashes an "offline" note before we know.
//
// When the orchestrator is unreachable the page falls back to the reference
// values in lib/journey/pipeline.ts (REFERENCE) and says so; it never shows a
// made-up "live" status.
// ---------------------------------------------------------------------------

export interface Live {
  summary: Summary | null
  demo: DemoState | null
  online: boolean | null
}

const POLL_MS = 15_000
const LiveContext = createContext<Live>({ summary: null, demo: null, online: null })

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [live, setLive] = useState<Live>({ summary: null, demo: null, online: null })

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [s, d] = await Promise.allSettled([api.summary(), api.demoState()])
      if (!alive) return
      setLive((prev) => ({
        summary: s.status === 'fulfilled' ? s.value : prev.summary,
        demo: d.status === 'fulfilled' ? d.value : prev.demo,
        online: s.status === 'fulfilled',
      }))
    }
    load()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>
}

export const useLive = () => useContext(LiveContext)

/** PIPELINE with live numbers overlaid (the static story when offline). */
export function useStages() {
  const { summary, demo } = useLive()
  return useMemo(() => liveStages(summary, demo), [summary, demo])
}

/** The LLM's display name, or null when offline / not reported. */
export function llmName(demo: DemoState | null): string | null {
  if (!demo?.llm) return null
  if (demo.llm.backend === 'off') return null
  return demo.llm.model ?? demo.llm.backend
}

export const fmtInt = (n: number) => n.toLocaleString('en-US')
