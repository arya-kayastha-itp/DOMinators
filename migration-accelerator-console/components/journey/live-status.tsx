'use client'

import { RotateCcw } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/journey/gsap'
import { PIPELINE, type LogLine, type StageStatus } from '@/lib/journey/pipeline'
import { useReducedMotion } from '@/lib/journey/use-media'
import { Magnetic } from './magnetic'

// ---------------------------------------------------------------------------
// A simulated orchestrator run: each stage goes queued → running → passed
// (or failed and back), its progress bar fills, and its log lines stream into
// one terminal. The script comes entirely from PIPELINE[].logs.
// ---------------------------------------------------------------------------

interface Entry extends LogLine { stage: number; ts: string }

const STATUS_LABEL: Record<StageStatus, string> = { queued: 'Queued', running: 'Running', passed: 'Passed', failed: 'Failed' }
const STATUS_TONE: Record<StageStatus, string> = {
  queued: 'text-[var(--j-faint)] border-[var(--j-line)]',
  running: 'text-[var(--j-accent)] border-[var(--j-accent)]/50',
  passed: 'text-[var(--j-success)] border-[var(--j-success)]/40',
  failed: 'text-[var(--j-fail)] border-[var(--j-fail)]/50',
}
const LEVEL_TONE: Record<NonNullable<LogLine['level']>, string> = {
  info: 'text-[var(--j-muted)]',
  ok: 'text-[var(--j-success)]',
  warn: 'text-[oklch(0.84_0.15_80)]',
  error: 'text-[var(--j-fail)]',
}

const LINE_GAP = 0.42 // seconds between log lines
const STAGE_GAP = 0.35 // pause between stages

function buildScript() {
  const entries: Entry[] = []
  let clock = 0
  PIPELINE.forEach((s, stage) => {
    s.logs.forEach((l) => {
      clock += LINE_GAP * 1000 + (l.level === 'error' ? 400 : 0)
      const secs = clock / 1000
      entries.push({ ...l, stage, ts: `${String(Math.floor(secs / 60)).padStart(2, '0')}:${(secs % 60).toFixed(1).padStart(4, '0')}` })
    })
    clock += STAGE_GAP * 1000
  })
  return entries
}

const initial = () => ({
  status: PIPELINE.map((): StageStatus => 'queued'),
  progress: PIPELINE.map(() => 0),
  shown: 0,
})

export function LiveStatus() {
  const root = useRef<HTMLElement>(null)
  const tlRef = useRef<gsap.core.Timeline | null>(null)
  const reduced = useReducedMotion()
  const script = useMemo(buildScript, [])
  const [run, setRun] = useState(initial)
  const [finished, setFinished] = useState(false)

  const complete = useCallback(
    () => ({ status: PIPELINE.map((s) => s.status), progress: PIPELINE.map(() => 1), shown: script.length }),
    [script],
  )

  useGSAP(
    () => {
      if (reduced) {
        // Reduced motion: show the finished run, no streaming.
        setRun(complete())
        setFinished(true)
        return
      }

      // One timeline of callbacks, replayable with restart(). Each callback
      // advances React state; bars and lines animate themselves with CSS
      // (transform/opacity only).
      const tl = gsap.timeline({ paused: true })
      let t = 0.3
      PIPELINE.forEach((stage, si) => {
        const lines = script.filter((e) => e.stage === si)
        tl.call(() => setRun((r) => ({ ...r, status: r.status.map((v, k) => (k === si ? 'running' : v)) })), undefined, t)
        lines.forEach((line, li) => {
          t += LINE_GAP + (line.level === 'error' ? 0.4 : 0)
          const index = script.indexOf(line)
          tl.call(
            () =>
              setRun((r) => ({
                shown: index + 1,
                // An error line fails the stage (and knocks its bar back, like a
                // rollback); the next line resumes it.
                status: r.status.map((v, k) => (k !== si ? v : line.level === 'error' ? 'failed' : 'running')),
                progress: r.progress.map((v, k) => (k !== si ? v : line.level === 'error' ? 0.2 : (li + 1) / lines.length)),
              })),
            undefined,
            t,
          )
        })
        t += 0.25
        tl.call(() => setRun((r) => ({ ...r, status: r.status.map((v, k) => (k === si ? stage.status : v)) })), undefined, t)
        t += STAGE_GAP
      })
      tl.call(() => setFinished(true), undefined, t)
      tlRef.current = tl

      // Start the run the first time the section is well into view; pause it
      // while it's off screen so it never plays unseen.
      ScrollTrigger.create({
        trigger: root.current,
        start: 'top 55%',
        end: 'bottom top',
        onEnter: () => (tl.progress() === 0 ? tl.play() : tl.resume()),
        onEnterBack: () => tl.progress() > 0 && tl.progress() < 1 && tl.resume(),
        onLeave: () => tl.pause(),
        onLeaveBack: () => tl.pause(),
      })
    },
    { scope: root, dependencies: [reduced, script], revertOnUpdate: true },
  )

  const replay = () => {
    if (reduced || !tlRef.current) return
    setRun(initial())
    setFinished(false)
    tlRef.current.restart()
  }

  const passed = run.status.filter((s) => s === 'passed').length
  const rollbacks = script.slice(0, run.shown).filter((e) => e.level === 'error').length

  return (
    <section ref={root} id="live" aria-labelledby="live-title" className="relative border-t border-[var(--j-line)]">
      <div className="mx-auto max-w-[1680px] px-4 py-28 sm:px-8 md:py-40 lg:px-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
          <p className="j-eyebrow md:col-span-3">03 — Live run</p>
          <div className="md:col-span-9">
            <h2 id="live-title" data-split className="j-h2">
              Watch it run. <em className="j-serif text-[var(--j-accent)]">Watch it recover.</em>
            </h2>
            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-[var(--j-muted)] md:text-base">
              A replay of one pilot wave. The cutover gate catches a bad deploy at 10%, rolls back by itself, and the retry goes green.
            </p>
          </div>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 md:mt-20 lg:grid-cols-12 lg:gap-6">
          {/* Stage rows */}
          <ol className="j-card divide-y divide-[var(--j-line)] overflow-hidden lg:col-span-6" aria-label="Stage status">
            {PIPELINE.map((stage, i) => {
              const status = run.status[i]
              return (
                <li key={stage.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-x-4 gap-y-2.5 px-5 py-4">
                  <span className="j-mono text-[11px] text-[var(--j-faint)]">{String(i + 1).padStart(2, '0')}</span>
                  <span className="truncate text-[15px] font-medium tracking-tight">{stage.name}</span>
                  <span className={`j-chip !gap-2 ${STATUS_TONE[status]}`} aria-live="polite">
                    <span className={`inline-block size-1.5 rounded-full bg-current ${status === 'running' ? 'animate-pulse' : ''}`} />
                    {STATUS_LABEL[status]}
                  </span>
                  <span className="col-span-3 col-start-1 block h-[3px] overflow-hidden rounded-full bg-[var(--j-line)] sm:col-span-2 sm:col-start-2">
                    <span
                      className={`block h-full origin-left rounded-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                        status === 'failed' ? 'bg-[var(--j-fail)]' : status === 'passed' ? 'bg-[var(--j-success)]' : 'bg-[var(--j-accent)]'
                      }`}
                      style={{ transform: `scaleX(${run.progress[i]})` }}
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
              <span className="j-mono text-[11px] text-[var(--j-muted)]">orchestrator · GET /events (SSE)</span>
              <span className={`ml-auto j-mono text-[11px] ${finished ? 'text-[var(--j-success)]' : 'text-[var(--j-faint)]'}`}>
                {passed}/{PIPELINE.length} passed{rollbacks ? ` · ${rollbacks} rollback caught` : ''}
              </span>
            </div>
            {/* Newest line at the bottom; older lines overflow off the top and are clipped — no JS scrolling. */}
            <div
              className="relative flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-5 py-4 [mask-image:linear-gradient(to_bottom,transparent,black_28%)]"
              role="log"
              aria-label="Run log"
            >
              {script.slice(0, run.shown).map((e, k) => (
                <p key={k} className="j-log-line j-mono flex gap-3 py-[3px] text-[12px] leading-5">
                  <span className="shrink-0 text-[var(--j-faint)]">{e.ts}</span>
                  <span className="hidden w-[74px] shrink-0 truncate text-[var(--j-accent)]/80 sm:block">{PIPELINE[e.stage].id}</span>
                  <span className={`min-w-0 ${LEVEL_TONE[e.level ?? 'info']}`}>{e.text}</span>
                </p>
              ))}
              {!finished && <span className="j-mono mt-1 inline-block h-4 w-2 animate-pulse bg-[var(--j-fg)]/70" aria-hidden />}
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <Magnetic>
            <button type="button" onClick={replay} disabled={reduced || !finished} className="j-btn j-btn-ghost disabled:opacity-40" data-cursor="Replay">
              <RotateCcw className="size-4" aria-hidden /> Replay the run
            </button>
          </Magnetic>
        </div>
      </div>
    </section>
  )
}
