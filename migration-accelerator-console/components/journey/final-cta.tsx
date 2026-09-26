'use client'

import { ArrowUpRight, Check } from 'lucide-react'
import { useRef } from 'react'
import { EASE_IN_OUT, EASE_OUT, gsap, SplitText, useGSAP } from '@/lib/journey/gsap'
import { PIPELINE } from '@/lib/journey/pipeline'
import { useReducedMotion } from '@/lib/journey/use-media'
import { Magnetic } from './magnetic'
import { scrollToTarget, useLenis } from './smooth-scroll'
import { TransitionLink } from './transition-link'

// ---------------------------------------------------------------------------
// Finale: the pipeline completes in miniature, the screen flashes success,
// and the closing headline rises line by line.
// ---------------------------------------------------------------------------

export function FinalCta() {
  const root = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const lenis = useLenis()

  useGSAP(
    () => {
      const q = gsap.utils.selector(root)
      if (reduced) {
        gsap.set(q('[data-done]'), { opacity: 1 })
        gsap.set(q('[data-rail-fill]'), { scaleX: 1 })
        return
      }

      let played = false
      // autoSplit re-splits the headline when fonts load or the width changes;
      // onSplit rebuilds the timeline against the new lines each time. The
      // animation it returns is reverted automatically before the next split.
      const split = SplitText.create(q('[data-cta-title]')[0], {
        type: 'lines',
        mask: 'lines',
        linesClass: 'j-split-line',
        autoSplit: true,
        onSplit(self) {
          const tl = gsap.timeline({
            paused: played,
            scrollTrigger: played ? undefined : { trigger: root.current, start: 'top 62%', toggleActions: 'play none none none' },
            onComplete: () => void (played = true),
          })
          // 1. The rail fills left to right and each stage ticks green as it's reached.
          tl.fromTo(q('[data-rail-fill]'), { scaleX: 0 }, { scaleX: 1, duration: 1.5, ease: EASE_IN_OUT })
            .fromTo(q('[data-done]'), { opacity: 0 }, { opacity: 1, duration: 0.35, stagger: 1.5 / PIPELINE.length, ease: 'power2.out' }, 0.1)
            .fromTo(q('[data-dot]'), { scale: 0.7 }, { scale: 1, duration: 0.8, stagger: 1.5 / PIPELINE.length, ease: EASE_OUT }, 0.1)
            // 2. Full-screen success flash.
            .fromTo(q('[data-flash]'), { autoAlpha: 0 }, { autoAlpha: 0.55, duration: 0.12, ease: 'power2.out' }, 1.55)
            .to(q('[data-flash]'), { autoAlpha: 0, duration: 1.1, ease: EASE_OUT }, 1.67)
            // 3. Headline lines rise out of their masks, then the actions.
            .fromTo(self.lines, { yPercent: 110 }, { yPercent: 0, duration: 1.4, stagger: 0.1, ease: EASE_OUT }, 1.6)
            .fromTo(q('[data-cta-fade]'), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 1.1, stagger: 0.08, ease: EASE_OUT }, 1.9)
          // Already seen: a re-split lands on the end state, no second flash.
          if (played) tl.progress(1)
          return tl
        },
      })

      return () => split.revert()
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  )

  return (
    <section ref={root} id="finale" aria-labelledby="finale-title" className="relative overflow-hidden border-t border-[var(--j-line)]">
      <div data-flash className="pointer-events-none fixed inset-0 z-[70] bg-[var(--j-success)] opacity-0 [visibility:hidden]" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[80vmax] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,oklch(0.72_0.21_293/0.18),transparent)]" aria-hidden />

      <div className="mx-auto flex min-h-dvh max-w-[1680px] flex-col justify-center px-4 py-28 sm:px-8 lg:px-12">
        {/* Miniature pipeline */}
        <div className="relative mx-auto w-full max-w-3xl" aria-hidden>
          <div className="absolute inset-x-[calc(100%/12)] top-1/2 h-px -translate-y-1/2 bg-[var(--j-line-strong)]">
            <div data-rail-fill className="h-full origin-left scale-x-0 bg-[var(--j-success)]" />
          </div>
          <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${PIPELINE.length}, minmax(0, 1fr))` }}>
            {PIPELINE.map((s) => (
              <li key={s.id} className="flex flex-col items-center">
                <span data-dot className="relative grid size-9 place-items-center rounded-full border border-[var(--j-line-strong)] bg-[var(--j-bg)] md:size-11">
                  <span data-done className="absolute inset-[-1px] grid place-items-center rounded-full bg-[var(--j-success)] text-[var(--j-bg)] opacity-0">
                    <Check className="size-4" strokeWidth={3} />
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <p data-cta-fade className="j-eyebrow mt-14 flex items-center justify-center gap-2 text-center md:mt-20">
          <span className="inline-block size-1.5 rounded-full bg-[var(--j-success)]" /> Pipeline complete · {PIPELINE.length}/{PIPELINE.length} stages passed
        </p>

        <h2 id="finale-title" data-cta-title className="j-display mx-auto mt-6 text-center">
          <span className="block">Legacy in.</span> <em className="j-serif block text-[var(--j-accent)]">Golden out.</em>
        </h2>

        <div data-cta-fade className="mt-12 flex flex-wrap items-center justify-center gap-3 md:mt-16">
          <Magnetic>
            <TransitionLink href="/" className="j-btn j-btn-primary" data-cursor="Open">
              Open the console <ArrowUpRight className="size-4" aria-hidden />
            </TransitionLink>
          </Magnetic>
          <Magnetic>
            <button type="button" onClick={() => scrollToTarget(lenis, '#top')} className="j-btn j-btn-ghost" data-cursor="Again">
              Replay the journey
            </button>
          </Magnetic>
        </div>

        <p data-cta-fade className="j-mono mx-auto mt-20 max-w-xl text-center text-[11px] leading-relaxed tracking-wide text-[var(--j-faint)]">
          Account A (legacy) → Account B (landing zone) · ap-south-1 · Claude on Amazon Bedrock decides, typed tools act, gates roll back.
        </p>
      </div>
    </section>
  )
}
