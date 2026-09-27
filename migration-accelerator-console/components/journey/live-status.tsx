'use client'

import { RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, api, get } from '@/lib/api'
import type { ConsoleEvent } from '@/lib/contracts'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/journey/gsap'
import { PIPELINE, REFERENCE, stagesReached, type StageStatus } from '@/lib/journey/pipeline'
import { useLive } from '@/lib/journey/use-live'
import { useReducedMotion } from '@/lib/journey/use-media'
import { Magnetic } from './magnetic'

// ---------------------------------------------------------------------------
// "03 — Live run": a replay of the most recent REAL cutover, read from the
// orchestrator's event log (GET /events/recent). Events keep their true
// relative timestamps; only the playback is sped up. Simulated events
// (payload.sim === true) are ignored. With no cutover on record it shows the
// latest real events; with the orchestrator offline it shows the recorded
// last recorded run as static facts — never a scripted log.
// ---------------------------------------------------------------------------

type Level = 'info' | 'ok' | 'warn' | 'error'
type Mode =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'run'; app: string; events: ConsoleEvent[]; steps: number[]; ended: boolean }
  | { kind: 'recent'; events: ConsoleEvent[] }

interface Entry { text: string; level: Level; tag: string; ts: string; at: number }
interface Row { key: string; label: string; status: StageStatus; progress: number; sub?: string; dur?: number }

const TERMINAL = new Set(['MIGRATED', 'ROLLED_BACK', 'CUTOVER_ABORTED'])
const PLAYBACK_S = 16 // a long run is compressed to about this many seconds
const MIN_GAP = 0.18 // never two lines closer than this in playback
const START = 0.3
const NO_EVENTS: ConsoleEvent[] = []

const STATUS_LABEL: Record<StageStatus, string> = { queued: 'Queued', running: 'Running', passed: 'Passed', failed: 'Failed' }
const STATUS_TONE: Record<StageStatus, string> = {
  queued: 'text-[var(--j-faint)] border-[var(--j-line)]',
  running: 'text-[var(--j-accent)] border-[var(--j-accent)]/50',
  passed: 'text-[var(--j-success)] border-[var(--j-success)]/40',
  failed: 'text-[var(--j-fail)] border-[var(--j-fail)]/50',
}
const LEVEL_TONE: Record<Level, string> = {
  info: 'text-[var(--j-muted)]',
  ok: 'text-[var(--j-success)]',
  warn: 'text-[oklch(0.84_0.15_80)]',
  error: 'text-[var(--j-fail)]',
}

const isReal = (e: ConsoleEvent) => e.payload?.sim !== true
const tsMs = (e: ConsoleEvent) => new Date(e.ts).getTime() || 0
const pct = (x: unknown) => (typeof x === 'number' ? `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0)}%` : '?')
const clock = (s: number) => `+${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`
const levelOf = (e: ConsoleEvent): Level => (e.level === 'success' ? 'ok' : e.level === 'warn' ? 'warn' : e.level === 'error' ? 'error' : 'info')

/** The most recent real cutover in `events` (oldest → newest), or null. */
function extractRun(events: ConsoleEvent[], fallbackSteps: number[]): Extract<Mode, { kind: 'run' }> | null {
  let a = -1
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.app_id && (e.type === 'CUTOVER_STARTED' || e.type === 'CUTOVER_ABORTED')) {
      a = i
      break
    }
  }
  if (a < 0) return null
  const anchor = events[a]
  const app = anchor.app_id!

  // Start at the orchestrator's "Traffic generator → …" notice for this run, if present.
  let s = a
  for (let i = a - 1; i >= 0 && i >= a - 400; i--) {
    const e = events[i]
    if (e.app_id !== app) continue
    if (e.type === 'SIM_NOTIFY' && String(e.payload?.message ?? '').startsWith('Traffic generator')) {
      s = i
      break
    }
    if (TERMINAL.has(e.type) || e.type === 'CUTOVER_STARTED') break
  }
  // End at MIGRATED / ROLLED_BACK / CUTOVER_ABORTED (or the latest event if it is still running).
  let end = -1
  for (let i = a; i < events.length; i++) {
    if (events[i].app_id === app && TERMINAL.has(events[i].type)) {
      end = i
      break
    }
  }
  const slice = events.slice(s, end < 0 ? events.length : end + 1).filter((e) => e.app_id === app)
  const steps = Array.isArray(anchor.payload?.steps) ? (anchor.payload.steps as number[]) : fallbackSteps
  return { kind: 'run', app, events: slice, steps, ended: end >= 0 }
}

async function loadMode(fallbackSteps: number[]): Promise<Mode> {
  let events: ConsoleEvent[]
  try {
    events = (await api.recentEvents(1500)).events.filter(isReal)
  } catch {
    return { kind: 'offline' }
  }
  const run = extractRun(events, fallbackSteps)
  if (run) return run
  // A busy log (e.g. a 1,000-app synthetic wave) can push the last real
  // cutover out of the recent window: look it up by type, then by app.
  try {
    const starts = (await get<{ events: ConsoleEvent[] }>('/events/recent?type=CUTOVER_STARTED&limit=100')).events.filter(isReal)
    const last = starts[starts.length - 1]
    if (last?.app_id) {
      const appEvents = (await get<{ events: ConsoleEvent[] }>(`/events/recent?app_id=${encodeURIComponent(last.app_id)}&limit=800`)).events.filter(isReal)
      const found = extractRun(appEvents, fallbackSteps)
      if (found) return found
    }
  } catch {
    /* fall through to recent events */
  }
  return { kind: 'recent', events: events.slice(-16) }
}

/** Real relative timestamps + a compressed playback schedule. */
function buildEntries(events: ConsoleEvent[]): { entries: Entry[]; speed: number; durationS: number } {
  if (!events.length) return { entries: [], speed: 1, durationS: 0 }
  const t0 = tsMs(events[0])
  const rel = events.map((e) => Math.max(0, (tsMs(e) - t0) / 1000))
  const durationS = rel[rel.length - 1]
  const speed = Math.max(1, durationS / PLAYBACK_S)
  let prev = START - MIN_GAP
  const entries = events.map((e, i) => {
    const at = Math.max(START + rel[i] / speed, prev + MIN_GAP)
    prev = at
    return { text: e.summary || e.type, level: levelOf(e), tag: e.agent === 'orchestrator' ? 'orch' : e.agent, ts: clock(rel[i]), at }
  })
  return { entries, speed, durationS }
}

/** Row states for a cutover run after the first `shown` events. */
function runRows(events: ConsoleEvent[], entries: Entry[], steps: number[], shown: number): Row[] {
  const seen = events.slice(0, shown)
  const atOf = (pred: (e: ConsoleEvent) => boolean) => {
    const i = events.findIndex(pred)
    return i < 0 ? undefined : entries[i].at
  }
  const started = atOf((e) => e.type === 'CUTOVER_STARTED' || e.type === 'CUTOVER_ABORTED')
  const pre: Row = { key: 'pre', label: 'Traffic + precheck', status: 'queued', progress: 0, dur: started !== undefined && entries[0] ? started - entries[0].at : undefined }
  if (seen.length) Object.assign(pre, { status: 'running', progress: 0.92 })
  const startedEv = seen.find((e) => e.type === 'CUTOVER_STARTED')
  const aborted = seen.find((e) => e.type === 'CUTOVER_ABORTED')
  if (startedEv) Object.assign(pre, { status: 'passed', progress: 1, sub: 'traffic ~20 req/s · target healthy' })
  if (aborted) Object.assign(pre, { status: 'failed', progress: 1, sub: String(aborted.payload?.reason ?? 'aborted') })

  const rolled = seen.find((e) => e.type === 'ROLLED_BACK')
  const rows: Row[] = steps.map((w) => {
    const set = atOf((e) => e.type === 'WEIGHT_SET' && e.payload?.weight === w)
    const gate = atOf((e) => (e.type === 'GATE_PASS' || e.type === 'GATE_FAIL') && e.payload?.weight === w)
    const row: Row = { key: `w${w}`, label: `${w}% to target`, status: 'queued', progress: 0, dur: set !== undefined && gate !== undefined ? gate - set : undefined }
    if (seen.some((e) => e.type === 'WEIGHT_SET' && e.payload?.weight === w)) Object.assign(row, { status: 'running', progress: 0.92 })
    const pass = seen.find((e) => e.type === 'GATE_PASS' && e.payload?.weight === w)
    const fail = seen.find((e) => e.type === 'GATE_FAIL' && e.payload?.weight === w)
    if (pass) {
      const p = pass.payload
      const p95 = typeof p.p95_ms === 'number' ? `${Math.round(p.p95_ms)} ms` : '?'
      Object.assign(row, { status: 'passed', progress: 1, sub: `target ${pct(p.target_share)} · errors ${pct(p.error_rate)} · p95 ${p95}` })
    }
    if (fail) {
      const reasons = Array.isArray(fail.payload?.reasons) ? (fail.payload.reasons as string[]).join('; ') : 'gate failed'
      Object.assign(row, { status: 'failed', progress: 1, sub: reasons })
    } else if (rolled && row.status === 'running') Object.assign(row, { status: 'failed', progress: 1 })
    return row
  })

  const result: Row = { key: 'result', label: 'Result', status: 'queued', progress: 0 }
  const migrated = seen.find((e) => e.type === 'MIGRATED')
  if (migrated) Object.assign(result, { status: 'passed', progress: 1, sub: 'MIGRATED' })
  if (rolled) Object.assign(result, { status: 'failed', progress: 1, sub: 'ROLLED_BACK · weights 100/0' })
  if (aborted) Object.assign(result, { status: 'failed', progress: 1, sub: 'ABORTED before any weight change' })
  return [pre, ...rows, result]
}

/** The recorded end-to-end run, shown only when the orchestrator is offline. */
function referenceRows(): Row[] {
  const r = REFERENCE.run
  return [
    { key: 'pre', label: 'Traffic + precheck', status: 'passed', progress: 1, sub: 'traffic ~20 req/s · target healthy' },
    ...REFERENCE.steps.map((w, i): Row => ({
      key: `w${w}`,
      label: `${w}% to target`,
      status: 'passed',
      progress: 1,
      sub: `target ${pct(r.targetShare[i])} · errors 0% · p95 ${r.p95}`,
    })),
    { key: 'result', label: 'Result', status: 'passed', progress: 1, sub: `MIGRATED · ${r.duration} end to end` },
  ]
}

export function LiveStatus() {
  const root = useRef<HTMLElement>(null)
  const tlRef = useRef<gsap.core.Timeline | null>(null)
  const reduced = useReducedMotion()
  const { summary, demo } = useLive()
  const [mode, setMode] = useState<Mode>({ kind: 'loading' })
  const [shown, setShown] = useState(0)
  const [finished, setFinished] = useState(false)
  const [busy, setBusy] = useState(false)

  const fallbackSteps = useMemo(() => demo?.cutover_config?.steps ?? [...REFERENCE.steps], [demo])
  const stepsRef = useRef(fallbackSteps)
  stepsRef.current = fallbackSteps

  const load = useCallback(async () => {
    setBusy(true)
    const next = await loadMode(stepsRef.current)
    setMode(next)
    setBusy(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const events = mode.kind === 'run' || mode.kind === 'recent' ? mode.events : NO_EVENTS
  const { entries, speed, durationS } = useMemo(() => buildEntries(events), [events])

  useGSAP(
    () => {
      setShown(0)
      setFinished(false)
      tlRef.current = null
      if (!entries.length) {
        setFinished(true)
        return
      }
      if (reduced) {
        // Reduced motion: show the whole run at once, no streaming.
        setShown(entries.length)
        setFinished(true)
        return
      }

      // One timeline of callbacks at the (compressed) real offsets. Each
      // callback advances React state; bars and lines animate with CSS.
      const tl = gsap.timeline({ paused: true })
      entries.forEach((e, i) => tl.call(() => setShown(i + 1), undefined, e.at))
      tl.call(() => setFinished(true), undefined, entries[entries.length - 1].at + 0.4)
      tlRef.current = tl

      // Play when the section is well into view; pause while off screen.
      const st = ScrollTrigger.create({
        trigger: root.current,
        start: 'top 55%',
        end: 'bottom top',
        onEnter: () => (tl.progress() === 0 ? tl.play() : tl.resume()),
        onEnterBack: () => tl.progress() > 0 && tl.progress() < 1 && tl.resume(),
        onLeave: () => tl.pause(),
        onLeaveBack: () => tl.pause(),
      })
      // Data can arrive after the reader is already here.
      if (st.isActive) tl.play()
    },
    { scope: root, dependencies: [reduced, entries], revertOnUpdate: true },
  )

  const replay = async () => {
    if (busy) return
    // Re-read the log first, so a run started since page load is picked up.
    await load()
  }

  // ------------------------------------------------------------------ view model

  let rows: Row[]
  let caption: React.ReactNode
  let headerRight = ''
  let rowsLabel = 'Cutover steps'
  if (mode.kind === 'run') {
    rows = runRows(mode.events, entries, mode.steps, shown)
    const first = mode.events[0]
    const date = first ? new Date(first.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
    caption = (
      <>
        Replay of the last real run · <span className="text-[var(--j-fg)]">{mode.app}</span> · {date}. Real events from the orchestrator log, real
        relative timestamps ({Math.round(durationS)} s end to end){speed > 1.05 ? `, played back at ×${speed.toFixed(speed < 10 ? 1 : 0)}` : ''}.
        {!mode.ended && ' This run is still in progress.'}
      </>
    )
    const decided = rows.filter((r) => r.key.startsWith('w') && r.status === 'passed').length
    const rolled = rows.some((r) => r.key === 'result' && r.status === 'failed')
    headerRight = `${decided}/${mode.steps.length} gates passed${rolled ? ' · rollback caught' : ''}`
  } else if (mode.kind === 'recent') {
    const reached = stagesReached(summary)
    rows = PIPELINE.map((s, i) => ({ key: s.id, label: s.name, status: reached[i] ? 'passed' : 'queued', progress: reached[i] ? 1 : 0 }))
    rowsLabel = 'Stage status'
    caption = (
      <>
        No cutover has run yet — start one from the console. Meanwhile, the most recent real events from the orchestrator log, with their real relative
        timestamps.
      </>
    )
    headerRight = `${reached.filter(Boolean).length}/${PIPELINE.length} stages reached`
  } else if (mode.kind === 'offline') {
    rows = referenceRows()
    caption = (
      <>
        Orchestrator offline — showing the last recorded run: <span className="text-[var(--j-fg)]">{REFERENCE.run.app}</span> cut over 10 → 50 → 100% with
        every gate green, then restored to legacy. Start the orchestrator to replay its real event log.
      </>
    )
    headerRight = 'last recorded run'
  } else {
    rows = []
    caption = <>Reading the orchestrator’s event log…</>
  }

  const shownEntries = entries.slice(0, shown)

  return (
    <section ref={root} id="live" aria-labelledby="live-title" className="relative border-t border-[var(--j-line)]">
      <div className="mx-auto max-w-[1680px] px-4 py-28 sm:px-8 md:py-40 lg:px-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
          <p className="j-eyebrow md:col-span-3">03 — Live run</p>
          <div className="md:col-span-9">
            <h2 id="live-title" data-split className="j-h2">
              Watch it run. <em className="j-serif text-[var(--j-accent)]">Watch the gates decide.</em>
            </h2>
            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-[var(--j-muted)] md:text-base" aria-live="polite">
              {caption}
            </p>
          </div>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 md:mt-20 lg:grid-cols-12 lg:gap-6">
          {/* Step / stage rows */}
          <ol className="j-card divide-y divide-[var(--j-line)] overflow-hidden lg:col-span-6" aria-label={rowsLabel}>
            {rows.length === 0 && <li className="px-5 py-4 text-[13px] text-[var(--j-faint)]">Loading…</li>}
            {rows.map((row, i) => {
              const running = row.status === 'running'
              return (
                <li key={row.key} className="grid grid-cols-[28px_1fr_auto] items-center gap-x-4 gap-y-2.5 px-5 py-4">
                  <span className="j-mono text-[11px] text-[var(--j-faint)]">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium tracking-tight">{row.label}</span>
                    {row.sub && <span className="j-mono mt-0.5 block truncate text-[11px] text-[var(--j-muted)]">{row.sub}</span>}
                  </span>
                  <span className={`j-chip !gap-2 ${STATUS_TONE[row.status]}`} aria-live="polite">
                    <span className={`inline-block size-1.5 rounded-full bg-current ${running ? 'animate-pulse' : ''}`} />
                    {STATUS_LABEL[row.status]}
                  </span>
                  <span className="col-span-3 col-start-1 block h-[3px] overflow-hidden rounded-full bg-[var(--j-line)] sm:col-span-2 sm:col-start-2">
                    <span
                      className={`block h-full origin-left rounded-full transition-transform ${
                        row.status === 'failed' ? 'bg-[var(--j-fail)]' : row.status === 'passed' ? 'bg-[var(--j-success)]' : 'bg-[var(--j-accent)]'
                      }`}
                      // While a step is observing, the bar creeps across the real (compressed) window.
                      style={{
                        transform: `scaleX(${row.progress})`,
                        transitionDuration: running && row.dur ? `${row.dur}s` : '500ms',
                        transitionTimingFunction: running ? 'linear' : 'cubic-bezier(0.16,1,0.3,1)',
                      }}
                    />
                  </span>
                </li>
              )
            })}
          </ol>

          {/* Terminal */}
          {/* Fixed height: the log must never set the row height (older lines clip off the top instead). */}
          <div className="j-card flex h-[440px] flex-col overflow-hidden lg:col-span-6">
            <div className="flex items-center gap-3 border-b border-[var(--j-line)] px-5 py-3.5">
              <span className="flex gap-1.5" aria-hidden>
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
              </span>
              <span className="j-mono truncate text-[11px] text-[var(--j-muted)]">
                {mode.kind === 'offline' ? 'orchestrator · offline' : 'orchestrator · GET /events/recent'}
              </span>
              <span className={`ml-auto shrink-0 j-mono text-[11px] ${finished && mode.kind === 'run' ? 'text-[var(--j-success)]' : 'text-[var(--j-faint)]'}`}>
                {headerRight}
              </span>
            </div>
            {/* Newest line at the bottom; older lines overflow off the top and are clipped — no JS scrolling. */}
            <div
              className="relative flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-5 py-4 [mask-image:linear-gradient(to_bottom,transparent,black_28%)]"
              role="log"
              aria-label="Run log"
            >
              {mode.kind === 'offline' && (
                <div className="j-mono text-[12px] leading-6 text-[var(--j-muted)]">
                  <p>No live connection to the orchestrator at {API_BASE}.</p>
                  <p className="text-[var(--j-faint)]">The log shows real events only, so it stays empty until the orchestrator is running.</p>
                </div>
              )}
              {(mode.kind === 'recent' || mode.kind === 'run') && entries.length === 0 && (
                <p className="j-mono text-[12px] leading-6 text-[var(--j-muted)]">No events yet — run discovery from the console.</p>
              )}
              {shownEntries.map((e, k) => (
                <p key={k} className="j-log-line j-mono flex gap-3 py-[3px] text-[12px] leading-5">
                  <span className="shrink-0 text-[var(--j-faint)]">{e.ts}</span>
                  <span className="hidden w-[74px] shrink-0 truncate text-[var(--j-accent)]/80 sm:block">{e.tag}</span>
                  <span className={`min-w-0 ${LEVEL_TONE[e.level]}`}>{e.text}</span>
                </p>
              ))}
              {!finished && entries.length > 0 && <span className="j-mono mt-1 inline-block h-4 w-2 animate-pulse bg-[var(--j-fg)]/70" aria-hidden />}
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <Magnetic>
            <button
              type="button"
              onClick={replay}
              disabled={busy || (mode.kind !== 'offline' && !finished)}
              className="j-btn j-btn-ghost disabled:opacity-40"
              data-cursor="Replay"
            >
              <RotateCcw className="size-4" aria-hidden /> {mode.kind === 'offline' ? 'Retry connection' : 'Replay the run'}
            </button>
          </Magnetic>
        </div>
      </div>
    </section>
  )
}
