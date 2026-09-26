'use client'

import { useCallback, useRef, useState } from 'react'
import { EASE_OUT, gsap, SplitText, useGSAP } from '@/lib/journey/gsap'
import { PIPELINE } from '@/lib/journey/pipeline'
import { LiveProvider } from '@/lib/journey/use-live'
import { useReducedMotion } from '@/lib/journey/use-media'
import { Cursor } from './cursor'
import { FinalCta } from './final-cta'
import { Hero } from './hero'
import { LiveStatus } from './live-status'
import { Magnetic } from './magnetic'
import { PipelineJourney, type OpenStage } from './pipeline-journey'
import { Preloader } from './preloader'
import { scrollToTarget, SmoothScroll, useLenis } from './smooth-scroll'
import { discFor, StagePanel } from './stage-panel'
import { RouteCurtain, TransitionLink } from './transition-link'

/* -------------------------------------------------------------------------- */

function TopBar() {
  const lenis = useLenis()
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 mix-blend-difference">
      <div className="mx-auto flex max-w-[1680px] items-center justify-between px-4 py-5 sm:px-8 lg:px-12">
        <button
          type="button"
          onClick={() => scrollToTarget(lenis, '#top')}
          className="pointer-events-auto flex items-center gap-2.5 text-sm font-semibold tracking-tight text-white"
          data-cursor="Top"
        >
          <span className="grid size-7 place-items-center rounded-full border border-white/60 text-[10px]">MA</span>
          <span className="hidden sm:inline">Migration Accelerator</span>
        </button>
        <Magnetic className="pointer-events-auto">
          <TransitionLink href="/" className="j-mono block py-2 text-[11px] uppercase tracking-[0.18em] text-white" data-cursor="Open">
            Open console ↗
          </TransitionLink>
        </Magnetic>
      </div>
    </header>
  )
}

/** Masked line reveal for every section heading marked data-split. */
function useSplitHeadings(root: React.RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion()
  useGSAP(
    () => {
      const headings = gsap.utils.toArray<HTMLElement>('[data-split]', root.current)
      if (reduced) {
        headings.forEach((el) =>
          gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true } }),
        )
        return
      }
      const played = new Set<HTMLElement>()
      const splits = headings.map((el) =>
        SplitText.create(el, {
          type: 'lines',
          mask: 'lines',
          linesClass: 'j-split-line',
          // Re-split when fonts land or the width changes; onSplit rebuilds the
          // reveal for the new lines (and skips it if it already played).
          autoSplit: true,
          onSplit(self) {
            if (played.has(el)) return
            return gsap.from(self.lines, {
              yPercent: 112,
              duration: 1.3,
              stagger: 0.1,
              ease: EASE_OUT,
              scrollTrigger: { trigger: el, start: 'top 86%', once: true },
              onComplete: () => void played.add(el),
            })
          },
        }),
      )
      return () => splits.forEach((s) => s.revert())
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  )
}

/* -------------------------------------------------------------------------- */

export function Journey() {
  const root = useRef<HTMLDivElement>(null)
  const origin = useRef<DOMRect | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [openStage, setOpenStage] = useState<number | null>(null)

  useSplitHeadings(root)

  const onPreloaded = useCallback(() => setLoaded(true), [])

  // Measure the node disc *before* the panel mounts (FLIP "First").
  const open = useCallback<OpenStage>((index, disc) => {
    const el = disc ?? discFor(PIPELINE[index].id)
    origin.current = el ? el.getBoundingClientRect() : null
    setOpenStage(index)
  }, [])

  return (
    <LiveProvider>
    <RouteCurtain>
      <SmoothScroll paused={!loaded || openStage !== null}>
        <div ref={root} className="journey-root">
          <a
            href="#pipeline"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[110] focus:rounded-full focus:bg-[var(--j-fg)] focus:px-4 focus:py-2 focus:text-sm focus:text-[var(--j-bg)]"
          >
            Skip to the pipeline
          </a>
          <TopBar />
          <main inert={openStage !== null}>
            <Hero ready={loaded} />
            <PipelineJourney onOpenStage={open} />
            <LiveStatus />
            <FinalCta />
          </main>

          {openStage !== null && <StagePanel index={openStage} origin={origin.current} onClosed={() => setOpenStage(null)} />}
          <Preloader onDone={onPreloaded} />
          <Cursor rootRef={root} />
          <div className="j-grain" aria-hidden />
        </div>
      </SmoothScroll>
    </RouteCurtain>
    </LiveProvider>
  )
}
