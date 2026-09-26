'use client'

import { useRef, useState } from 'react'
import { EASE_IN_OUT, EASE_OUT, gsap, useGSAP } from '@/lib/journey/gsap'
import { PIPELINE } from '@/lib/journey/pipeline'
import { useReducedMotion } from '@/lib/journey/use-media'

// ---------------------------------------------------------------------------
// Counts 0 → 100 while fonts load, then lifts away to reveal the hero. The
// hero intro is started (onDone) while the curtain is still moving, so the
// two overlap instead of playing back to back.
// ---------------------------------------------------------------------------

export function Preloader({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const count = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotion()
  const [gone, setGone] = useState(false)

  useGSAP(
    () => {
      const q = gsap.utils.selector(root)
      const fonts = document.fonts?.ready ?? Promise.resolve()

      if (reduced) {
        // Reduced motion: no counter theatre, just a short fade once fonts are in.
        fonts.then(() => {
          onDone()
          gsap.to(root.current, { autoAlpha: 0, duration: 0.4, ease: 'power1.out', onComplete: () => setGone(true) })
        })
        return
      }

      const counter = { v: 0 }
      const render = () => {
        if (count.current) count.current.textContent = String(Math.round(counter.v)).padStart(3, '0')
      }
      const setBar = gsap.quickSetter(q('[data-bar]')[0], 'scaleX')

      // Phase 1: count to 80 on a fixed clock. Phase 2 waits for fonts, then
      // finishes the count and hands over.
      const tl = gsap.timeline()
      tl.to(counter, { v: 80, duration: 1.3, ease: EASE_IN_OUT, onUpdate: () => (render(), setBar(counter.v / 100)) })
      tl.add(() => {
        tl.pause()
        fonts.then(() => tl.resume())
      })
      tl.to(counter, { v: 100, duration: 0.55, ease: EASE_OUT, onUpdate: () => (render(), setBar(counter.v / 100)) })
      // Exit: digits slide out of their mask, the panel lifts with power4.inOut.
      tl.to(q('[data-digits]'), { yPercent: -110, duration: 0.7, ease: 'power4.in' }, '+=0.15')
      tl.to(q('[data-fade]'), { autoAlpha: 0, duration: 0.4, ease: 'power2.in' }, '<')
      tl.to(root.current, { yPercent: -100, duration: 1.1, ease: EASE_IN_OUT }, '-=0.25')
      tl.add(onDone, '-=0.75')
      tl.add(() => setGone(true))
    },
    { scope: root, dependencies: [reduced] },
  )

  if (gone) return null

  return (
    <div ref={root} className="fixed inset-0 z-[100] flex flex-col justify-between bg-[var(--j-bg-2)] px-4 py-6 sm:px-8 lg:px-12" role="status" aria-label="Loading">
      <div data-fade className="flex items-center justify-between">
        <span className="j-eyebrow">Migration Accelerator</span>
        <span className="j-eyebrow hidden sm:inline">{PIPELINE.map((s) => s.name).join(' → ')}</span>
      </div>

      <div className="flex items-end justify-between gap-6">
        <p data-fade className="j-eyebrow max-w-[16ch] pb-4">Preparing the pipeline</p>
        <div className="overflow-hidden">
          <span data-digits className="block">
            <span ref={count} className="j-display block tabular-nums" aria-hidden>
              000
            </span>
          </span>
        </div>
      </div>

      <div data-fade className="absolute inset-x-0 bottom-0 h-px bg-[var(--j-line)]">
        <div data-bar className="h-full origin-left scale-x-0 bg-[var(--j-accent)]" />
      </div>
    </div>
  )
}
