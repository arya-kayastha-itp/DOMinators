'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EASE_OUT, gsap, ScrollTrigger, useGSAP } from '@/lib/journey/gsap'
import { buildPath, horizontalLayout, type Point } from '@/lib/journey/path'
import { PIPELINE, type PipelineStage } from '@/lib/journey/pipeline'
import { useStages } from '@/lib/journey/use-live'
import { useDesktop, useReducedMotion } from '@/lib/journey/use-media'
import { useLenis } from './smooth-scroll'
import { StageCard } from './stage-card'

export type OpenStage = (index: number, origin: HTMLElement | null) => void

const N = PIPELINE.length
const pad = (n: number) => String(n).padStart(2, '0')
const nodeState = (i: number, active: number) => (i < active ? 'done' : i === active ? 'active' : 'upcoming')

// ---------------------------------------------------------------------------
// The centerpiece. Desktop (wide + fine pointer, motion allowed) gets a pinned
// horizontal track; everything else gets a vertical stacked track. Both render
// the stages as an ordered list of real buttons, so the content is the same
// for keyboard and screen-reader users.
// ---------------------------------------------------------------------------

export function PipelineJourney({ onOpenStage }: { onOpenStage: OpenStage }) {
  const desktop = useDesktop()
  const reduced = useReducedMotion()
  const horizontal = desktop && !reduced

  return (
    <section id="pipeline" aria-labelledby="pipeline-title" className="relative border-t border-[var(--j-line)]">
      <div className="mx-auto grid max-w-[1680px] grid-cols-1 gap-8 px-4 pb-10 pt-28 sm:px-8 md:grid-cols-12 md:pb-16 md:pt-40 lg:px-12">
        <p className="j-eyebrow md:col-span-3">02 — The pipeline</p>
        <div className="md:col-span-9">
          <h2 id="pipeline-title" data-split className="j-h2">
            Follow one app through <em className="j-serif text-[var(--j-accent)]">the machine.</em>
          </h2>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-[var(--j-muted)] md:text-base">
            Scroll to push a request through all {N} stages, from the legacy estate to the landing zone. Select any node to open its full story.
          </p>
        </div>
      </div>

      {horizontal ? <HorizontalTrack onOpenStage={onOpenStage} /> : <StackedTrack reduced={reduced} onOpenStage={onOpenStage} />}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Node                                                                       */
/* -------------------------------------------------------------------------- */

function StageNode({
  stage,
  index,
  state,
  onOpen,
  onFocus,
  style,
  labelSide = 'top',
  size = 'lg',
}: {
  stage: PipelineStage
  index: number
  state: string
  onOpen: (disc: HTMLElement | null) => void
  onFocus?: () => void
  style?: React.CSSProperties
  labelSide?: 'top' | 'right'
  size?: 'lg' | 'sm'
}) {
  const disc = useRef<HTMLSpanElement>(null)
  const Icon = stage.icon
  return (
    <button
      type="button"
      data-node
      data-state={state}
      onClick={() => onOpen(disc.current)}
      onFocus={onFocus}
      style={style}
      data-cursor="Open"
      aria-label={`${stage.name}: open the full stage story`}
      className="j-node group absolute flex items-center justify-center"
    >
      <span className={`j-node-scale relative grid place-items-center ${size === 'lg' ? 'size-16' : 'size-11'}`}>
        {/* data-flip-id ties this disc to the deep-dive panel for the FLIP transition. */}
        <span ref={disc} data-flip-id={`stage-${stage.id}`} className="j-node-disc absolute inset-0 rounded-full" />
        <span className="j-node-glow" />
        <span className="j-node-done" />
        <Icon className={`j-node-icon ${size === 'lg' ? 'size-6' : 'size-[18px]'}`} aria-hidden />
      </span>
      <span
        className={`j-mono pointer-events-none absolute whitespace-nowrap text-[11px] uppercase tracking-[0.16em] ${
          labelSide === 'top' ? 'bottom-full mb-5' : 'left-full ml-4'
        }`}
      >
        <span className="text-[var(--j-faint)]">{pad(index + 1)}</span> <span className="text-[var(--j-fg)]">{stage.name}</span>
      </span>
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Horizontal (desktop): pinned, scrubbed                                     */
/* -------------------------------------------------------------------------- */

function HorizontalTrack({ onOpenStage }: { onOpenStage: OpenStage }) {
  const stages = useStages()
  const pinRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const motionRef = useRef<SVGPathElement>(null)
  const packetRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const segRefs = useRef<SVGPathElement[]>([])
  const doneRefs = useRef<SVGPathElement[]>([])
  const cardRefs = useRef<HTMLElement[]>([])
  const trailRefs = useRef<HTMLDivElement[]>([])
  const stRef = useRef<ScrollTrigger | null>(null)
  const arrivalsRef = useRef<number[]>([])
  const activeRef = useRef(0)
  const dockedRef = useRef(true)
  const lenis = useLenis()

  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [active, setActive] = useState(0)
  const [docked, setDocked] = useState(true)

  // Measure the pinned frame; the track geometry is derived from it.
  useLayoutEffect(() => {
    const el = pinRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      setSize((s) => (s && Math.abs(s.w - w) < 2 && Math.abs(s.h - h) < 2 ? s : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => (size ? horizontalLayout(N, size.w, size.h) : null), [size])
  const paths = useMemo(() => (layout ? buildPath(layout.points, 'x') : null), [layout])

  // Master scroll timeline: builds once per layout and is fully reverted
  // (ScrollTrigger + pin included) when the layout changes or on unmount.
  useGSAP(
    () => {
      if (!size || !layout || !paths || !motionRef.current || !packetRef.current || !trackRef.current) return
      const segs = segRefs.current.slice(0, N - 1)
      const done = doneRefs.current.slice(0, N - 1)
      const packet = packetRef.current
      const track = trackRef.current
      const trail = trailRefs.current

      // 1. Where each node sits along the full path, as a 0–1 fraction. The full
      //    path is the segments joined, so this is a running sum of their lengths.
      const lens = segs.map((s) => s.getTotalLength())
      const total = lens.reduce((a, b) => a + b, 0)
      const fractions = lens.reduce<number[]>((acc, l) => [...acc, acc[acc.length - 1] + l / total], [0])

      // 2. Hide each connection by offsetting its dash by its own length; drawing
      //    it is just scrubbing the offset back to 0.
      segs.forEach((s, i) => gsap.set(s, { strokeDasharray: lens[i], strokeDashoffset: lens[i] }))
      gsap.set(done, { opacity: 0 })
      gsap.set([packet, ...trail], { xPercent: -50, yPercent: -50, x: layout.points[0].x, y: layout.points[0].y })

      // 3. Timeline in abstract units: a short lead-in, then per connection
      //    SEG units of travel followed by DWELL units parked on the node, so
      //    each card stays open for a beat before the packet moves on.
      const SEG = 1
      const DWELL = 0.6
      const tl = gsap.timeline({
        defaults: { ease: 'none' }, // scrubbed timeline: linear by design, scrub adds the smoothing
        scrollTrigger: {
          trigger: pinRef.current,
          start: 'top top',
          end: () => `+=${Math.round((N - 1) * window.innerHeight * 1.15)}`,
          pin: true,
          scrub: 0.9,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          refreshPriority: 1, // lay out this pin before the sections below measure themselves
        },
      })
      tl.to({}, { duration: 0.5 }) // parked on the first node
      const arrivals = [0]
      const departures: number[] = []
      for (let i = 0; i < N - 1; i++) {
        const at = tl.duration()
        departures.push(at)
        // Path draws itself…
        tl.to(segs[i], { strokeDashoffset: 0, duration: SEG }, at)
        // …while the packet rides exactly the same stretch of the full path.
        tl.to(packet, { motionPath: { path: motionRef.current, start: fractions[i], end: fractions[i + 1] }, duration: SEG }, at)
        // On arrival the finished connection cross-fades to the success colour.
        tl.to(done[i], { opacity: 1, duration: 0.12 }, at + SEG)
        arrivals.push(at + SEG)
        tl.to({}, { duration: DWELL })
      }

      // 4. Every frame of the (smoothed) timeline: follow the packet with the
      //    camera, fill the HUD progress bar, and work out which stage is
      //    active (last node reached) and whether the packet is docked on it
      //    (between arriving and leaving) — only a docked stage shows its card.
      const setTrackX = gsap.quickSetter(track, 'x', 'px')
      const setProgress = gsap.quickSetter(progressRef.current, 'scaleX')
      const minX = size.w - layout.trackWidth
      tl.eventCallback('onUpdate', () => {
        const px = gsap.getProperty(packet, 'x') as number
        setTrackX(gsap.utils.clamp(minX, 0, size.w * 0.5 - px))
        setProgress(tl.progress())
        const t = tl.time()
        let a = 0
        for (let i = 0; i < arrivals.length; i++) if (t >= arrivals[i] - 0.02) a = i
        const isDocked = a === N - 1 || t < departures[a] + 0.02
        if (a !== activeRef.current) {
          activeRef.current = a
          setActive(a)
        }
        if (isDocked !== dockedRef.current) {
          dockedRef.current = isDocked
          setDocked(isDocked)
        }
      })

      // 5. Comet trail: each ghost eases toward the one ahead of it. Runs on the
      //    ticker so the tail settles after the scroll stops.
      const pos = trail.map(() => ({ x: layout.points[0].x, y: layout.points[0].y }))
      const setters = trail.map((el) => ({ x: gsap.quickSetter(el, 'x', 'px'), y: gsap.quickSetter(el, 'y', 'px') }))
      const tick = () => {
        let tx = gsap.getProperty(packet, 'x') as number
        let ty = gsap.getProperty(packet, 'y') as number
        pos.forEach((p, k) => {
          p.x += (tx - p.x) * 0.38
          p.y += (ty - p.y) * 0.38
          setters[k].x(p.x)
          setters[k].y(p.y)
          tx = p.x
          ty = p.y
        })
      }
      gsap.ticker.add(tick)

      stRef.current = tl.scrollTrigger ?? null
      arrivalsRef.current = arrivals.map((a) => a / tl.duration())
      // Sections below were measured before this pin existed: re-measure all.
      ScrollTrigger.refresh()

      return () => gsap.ticker.remove(tick)
    },
    { dependencies: [layout, paths], revertOnUpdate: true },
  )

  // Card choreography for the active stage — time-based, not scrubbed, so it
  // always opens with the same expo.out snap however fast the user scrolls.
  useGSAP(
    () => {
      // The packet is absorbed into a node while docked, and re-emerges to travel.
      if (packetRef.current) gsap.to(packetRef.current, { scale: docked ? 0 : 1, duration: 0.5, ease: EASE_OUT })

      cardRefs.current.forEach((card, i) => {
        if (!card) return
        const items = card.querySelectorAll('[data-card-item]')
        gsap.killTweensOf([card, items])
        if (i === active && docked) {
          gsap.fromTo(card, { autoAlpha: 0, scale: 0.86, y: 28 }, { autoAlpha: 1, scale: 1, y: 0, duration: 1.1, ease: EASE_OUT })
          gsap.fromTo(items, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.045, delay: 0.1, ease: EASE_OUT })
        } else if (gsap.getProperty(card, 'autoAlpha') !== 0) {
          gsap.to(card, { autoAlpha: 0, scale: 0.96, y: 12, duration: 0.3, ease: 'power2.out' })
        }
      })
    },
    { dependencies: [active, docked, layout] },
  )

  // Keyboard: focusing a node scrolls the timeline to the moment it activates.
  const focusStage = (i: number) => {
    const st = stRef.current
    if (!st || activeRef.current === i) return
    const y = st.start + (st.end - st.start) * (arrivalsRef.current[i] ?? 0) + 2
    if (lenis) lenis.scrollTo(y, { duration: 1.2 })
    else window.scrollTo(0, y)
  }

  const cardW = size ? Math.min(640, size.w - 96) : 640

  return (
    <div ref={pinRef} className="relative h-dvh overflow-hidden">
      {/* HUD — stays put while the track moves underneath. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 mx-auto flex max-w-[1680px] items-center gap-6 px-12 pt-24">
        <span className="j-mono text-[11px] uppercase tracking-[0.18em] text-[var(--j-muted)]" aria-live="polite">
          Stage <span className="text-[var(--j-fg)]">{pad(active + 1)}</span> / {pad(N)} · {PIPELINE[active].name}
        </span>
        <span className="relative h-px flex-1 overflow-hidden bg-[var(--j-line)]">
          <span ref={progressRef} className="absolute inset-0 origin-left scale-x-0 bg-[var(--j-accent)]" />
        </span>
      </div>
      <p className="j-mono pointer-events-none absolute bottom-8 left-12 z-20 text-[11px] uppercase tracking-[0.18em] text-[var(--j-faint)]">
        Scroll to advance · select a node to dive in
      </p>

      {layout && paths && size && (
        <div ref={trackRef} className="absolute inset-y-0 left-0 will-change-transform" style={{ width: layout.trackWidth }}>
          <svg className="absolute inset-0 overflow-visible" width={layout.trackWidth} height={size.h} viewBox={`0 0 ${layout.trackWidth} ${size.h}`} aria-hidden>
            <defs>
              <linearGradient id="j-draw" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="oklch(0.72 0.21 293 / 0.35)" />
                <stop offset="1" stopColor="oklch(0.72 0.21 293)" />
              </linearGradient>
            </defs>
            {/* Lead-in and lead-out so the path enters and leaves the frame. */}
            <path d={`M 0 ${layout.points[0].y} L ${layout.points[0].x} ${layout.points[0].y}`} stroke="var(--j-line)" strokeWidth={1} fill="none" />
            <path
              d={`M ${layout.points[N - 1].x} ${layout.points[N - 1].y} L ${layout.trackWidth} ${layout.points[N - 1].y}`}
              stroke="var(--j-line)"
              strokeWidth={1}
              fill="none"
            />
            {/* The route not yet travelled. */}
            <path ref={motionRef} d={paths.full} stroke="var(--j-line-strong)" strokeWidth={1.5} strokeDasharray="2 10" strokeLinecap="round" fill="none" />
            {paths.segments.map((d, i) => (
              <g key={i}>
                <path ref={(el) => void (el && (segRefs.current[i] = el))} d={d} stroke="url(#j-draw)" strokeWidth={3} strokeLinecap="round" fill="none" />
                <path ref={(el) => void (el && (doneRefs.current[i] = el))} d={d} stroke="var(--j-success)" strokeWidth={3} strokeLinecap="round" fill="none" opacity={0} />
              </g>
            ))}
          </svg>

          {/* Comet trail + packet (positioned by MotionPath via transforms). */}
          {[10, 8, 6, 5, 4].map((s, k) => (
            <div
              key={k}
              ref={(el) => void (el && (trailRefs.current[k] = el))}
              className="j-trail"
              style={{ width: s, height: s, opacity: 0.5 - k * 0.09 }}
              aria-hidden
            />
          ))}
          <div ref={packetRef} className="j-packet z-10" aria-hidden />

          <ol aria-label="Pipeline stages">
            {stages.map((stage, i) => {
              const p = layout.points[i]
              return (
                <li key={stage.id}>
                  <StageNode
                    stage={stage}
                    index={i}
                    state={nodeState(i, active)}
                    onOpen={(disc) => onOpenStage(i, disc)}
                    onFocus={() => focusStage(i)}
                    style={{ left: p.x, top: p.y, translate: '-50% -50%' }}
                  />
                  <StageCard
                    ref={(el) => void (el && (cardRefs.current[i] = el))}
                    stage={stage}
                    index={i}
                    total={N}
                    layout="wide"
                    onOpen={() => onOpenStage(i, null)}
                    className="invisible absolute origin-top opacity-0"
                    style={{
                      width: cardW,
                      top: layout.cardTop,
                      left: gsap.utils.clamp(24, layout.trackWidth - cardW - 24, p.x - cardW / 2),
                    }}
                  />
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Stacked (mobile + reduced motion): vertical, no pinning                    */
/* -------------------------------------------------------------------------- */

function StackedTrack({ reduced, onOpenStage }: { reduced: boolean; onOpenStage: OpenStage }) {
  const stages = useStages()
  const listRef = useRef<HTMLOListElement>(null)
  const nodeWrapRefs = useRef<HTMLDivElement[]>([])
  const cardRefs = useRef<HTMLElement[]>([])
  const drawRef = useRef<SVGPathElement>(null)
  const packetRef = useRef<HTMLDivElement>(null)
  const revealed = useRef<Set<number>>(new Set())
  const [points, setPoints] = useState<Point[]>([])
  const [height, setHeight] = useState(0)
  const [active, setActive] = useState(reduced ? N - 1 : -1)

  // The path runs through the real node positions, so measure them.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const top = list.getBoundingClientRect().top
      setHeight(list.offsetHeight)
      setPoints(
        nodeWrapRefs.current.slice(0, N).map((el, i) => {
          const r = el.getBoundingClientRect()
          return { x: 22 + (i % 2 === 0 ? -6 : 6), y: Math.round(r.top - top + r.height / 2) }
        }),
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(list)
    return () => ro.disconnect()
  }, [])

  const path = useMemo(() => (points.length === N ? buildPath(points, 'y').full : ''), [points])

  useGSAP(
    () => {
      if (!path || !drawRef.current) return
      const cards = cardRefs.current.slice(0, N)
      if (reduced) {
        // No scrubbing, no pinning: everything is lit; cards simply fade in.
        cards.forEach((card) =>
          gsap.fromTo(card, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: 'power1.out', scrollTrigger: { trigger: card, start: 'top 90%', once: true } }),
        )
        return
      }

      // Draw the path and move the packet in step with the scroll, from the
      // first node reaching the 60% line to the last one reaching it.
      const len = drawRef.current.getTotalLength()
      gsap.set(drawRef.current, { strokeDasharray: len, strokeDashoffset: len })
      gsap.set(packetRef.current, { xPercent: -50, yPercent: -50, x: points[0].x, y: points[0].y })
      gsap
        .timeline({
          defaults: { ease: 'none' },
          scrollTrigger: { trigger: nodeWrapRefs.current[0], start: 'center 60%', endTrigger: nodeWrapRefs.current[N - 1], end: 'center 60%', scrub: 0.6 },
        })
        .to(drawRef.current, { strokeDashoffset: 0 }, 0)
        .to(packetRef.current, { motionPath: { path: drawRef.current } }, 0)

      // Each node activates as it crosses the same line.
      nodeWrapRefs.current.slice(0, N).forEach((el, i) =>
        ScrollTrigger.create({ trigger: el, start: 'center 60%', onEnter: () => setActive(i), onLeaveBack: () => setActive(i - 1) }),
      )
    },
    { dependencies: [path, reduced], revertOnUpdate: true },
  )

  // Open (first visit) or dim (passed) each card as the active stage moves.
  useGSAP(
    () => {
      if (reduced) return
      cardRefs.current.slice(0, N).forEach((card, i) => {
        const opacity = i === active ? 1 : i < active ? 0.45 : 0.28
        gsap.to(card, { opacity, duration: 0.6, ease: EASE_OUT })
        if (i === active && !revealed.current.has(i)) {
          revealed.current.add(i)
          gsap.fromTo(card, { scale: 0.95, y: 20 }, { scale: 1, y: 0, duration: 1, ease: EASE_OUT })
          gsap.fromTo(card.querySelectorAll('[data-card-item]'), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.05, ease: EASE_OUT })
        }
      })
    },
    { dependencies: [active, reduced] },
  )

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 sm:px-8">
      <ol ref={listRef} className="relative flex flex-col gap-10" aria-label="Pipeline stages">
        {path && (
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={44} height={height} aria-hidden>
            <path d={path} stroke="var(--j-line-strong)" strokeWidth={1.5} strokeDasharray="2 8" fill="none" />
            <path ref={drawRef} d={path} stroke={reduced ? 'var(--j-success)' : 'var(--j-accent)'} strokeWidth={2.5} strokeLinecap="round" fill="none" />
          </svg>
        )}
        {!reduced && path && <div ref={packetRef} className="j-packet z-10 !size-3" aria-hidden />}

        {stages.map((stage, i) => (
          <li key={stage.id} className="relative grid grid-cols-[44px_1fr] gap-4">
            <div ref={(el) => void (el && (nodeWrapRefs.current[i] = el))} className="relative mt-5 h-11">
              <StageNode
                stage={stage}
                index={i}
                size="sm"
                labelSide="right"
                state={reduced ? 'reached' : nodeState(i, active)}
                onOpen={(disc) => onOpenStage(i, disc)}
                style={{ left: points[i]?.x ?? 22, top: '50%', translate: '-50% -50%' }}
              />
            </div>
            <StageCard
              ref={(el) => void (el && (cardRefs.current[i] = el))}
              stage={stage}
              index={i}
              total={N}
              onOpen={() => onOpenStage(i, null)}
              className="mt-14"
              style={reduced ? undefined : { opacity: 0.28 }}
            />
          </li>
        ))}
      </ol>
    </div>
  )
}
