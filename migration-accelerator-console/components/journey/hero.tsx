'use client'

import dynamic from 'next/dynamic'
import { useRef } from 'react'
import { EASE_IN_OUT, EASE_OUT, gsap, SplitText, useGSAP } from '@/lib/journey/gsap'
import { fmtMonth, REFERENCE } from '@/lib/journey/pipeline'
import { fmtInt, useLive } from '@/lib/journey/use-live'
import { useDesktop, useReducedMotion } from '@/lib/journey/use-media'
import { scrollToTarget, useLenis } from './smooth-scroll'

// WebGL is a separate chunk that only desktop visitors download.
const HeroField = dynamic(() => import('./hero-field'), { ssr: false })

export function Hero({ ready }: { ready: boolean }) {
  const root = useRef<HTMLElement>(null)
  const introPlayed = useRef(false)
  const reduced = useReducedMotion()
  const desktop = useDesktop()
  const lenis = useLenis()
  const { summary, online } = useLive()

  // Fleet size: live from the orchestrator once discovery has run, otherwise
  // the real fleet (6 real apps + 1,000 synthetic from fleet.json).
  const apps = fmtInt(summary?.discovered ? summary.apps_total : REFERENCE.appsTotal)
  const stats = [
    { value: '4', label: 'agents' },
    { value: apps, label: 'apps in the fleet' },
    { value: '< 2 s', label: 'auto-rollback' },
  ]

  useGSAP(
    () => {
      const q = gsap.utils.selector(root)
      if (reduced) {
        if (introPlayed.current) return
        introPlayed.current = true
        // Reduced motion: one gentle fade, no movement.
        gsap.fromTo(q('[data-hero-fade]'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: 'power1.out', stagger: 0.05 })
        return
      }

      // Hold everything hidden until the preloader hands over.
      gsap.set(q('[data-hero-fade]'), { autoAlpha: 0, y: 24 })
      const split = SplitText.create(q('h1')[0], { type: 'words', mask: 'words', wordsClass: 'j-word' })
      gsap.set(split.words, { yPercent: 115, rotate: 4 })
      if (!ready) return () => split.revert()

      if (introPlayed.current) {
        // The headline number changed after the intro (live data arrived):
        // re-split the new text and land on the end state, no second intro.
        gsap.set(split.words, { yPercent: 0, rotate: 0 })
        gsap.set(q('[data-hero-fade]'), { autoAlpha: 1, y: 0 })
      } else {
        // Intro: words rise out of their masks one after another, then the
        // supporting copy settles in.
        introPlayed.current = true
        const tl = gsap.timeline({ defaults: { ease: EASE_OUT } })
        tl.to(split.words, { yPercent: 0, rotate: 0, duration: 1.5, stagger: 0.075 })
          .to(q('[data-hero-fade]'), { autoAlpha: 1, y: 0, duration: 1.2, stagger: 0.08 }, 0.55)
      }

      // Scroll-out: the headline drifts up and fades as the pipeline arrives (scrubbed, so linear).
      gsap.to(q('[data-hero-parallax]'), {
        yPercent: -18,
        autoAlpha: 0.15,
        ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true },
      })

      // Scroll cue: a dot that keeps travelling down its track.
      gsap.fromTo(q('[data-cue-dot]'), { yPercent: -120 }, { yPercent: 420, duration: 1.8, ease: EASE_IN_OUT, repeat: -1, delay: 1.4 })

      return () => split.revert()
    },
    // `apps` is a dependency because SplitText owns the headline's DOM: the h1 is
    // keyed on it, so a new number means a fresh element to split.
    { scope: root, dependencies: [ready, reduced, apps], revertOnUpdate: true },
  )

  return (
    <section ref={root} id="top" className="relative isolate flex min-h-dvh flex-col overflow-hidden" aria-labelledby="hero-title">
      {/* Background: WebGL on desktop, CSS gradient everywhere else. */}
      <div className="absolute inset-0 -z-10" aria-hidden>
        <div className="hero-fallback absolute inset-0" />
        {desktop && !reduced && <HeroField />}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[var(--j-bg)] to-transparent" />
      </div>

      <div data-hero-parallax className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col justify-end px-4 pb-10 pt-32 sm:px-8 md:pb-14 lg:px-12">
        <p data-hero-fade className="j-eyebrow mb-6 flex items-center gap-3 md:mb-10">
          <span className="inline-block size-1.5 rounded-full bg-[var(--j-accent)]" />
          Cloud Migration Accelerator — the pipeline
        </p>

        <h1 key={apps} id="hero-title" className="j-display">
          <span className="block">Migrate</span>{' '}
          <span className="block">{apps} apps.</span>{' '}
          <span className="block">
            Break <em className="j-serif text-[var(--j-accent)]">nothing.</em>
          </span>
        </h1>

        <div className="mt-10 grid grid-cols-1 items-end gap-8 md:mt-16 md:grid-cols-12">
          <p data-hero-fade className="max-w-md text-[15px] leading-relaxed text-[var(--j-muted)] md:col-span-5 md:text-base">
            Four agents discover, plan, rebuild and cut over a legacy AWS estate onto a hardened landing zone. Wave by wave, with gates that
            roll back on their own.
          </p>

          <div data-hero-fade className="md:col-span-5 md:col-start-7">
            <dl className="grid grid-cols-3 gap-4">
              {stats.map((s) => (
                <div key={s.label} className="border-t border-[var(--j-line-strong)] pt-3">
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="text-2xl font-semibold tracking-tight md:text-3xl">{s.value}</dd>
                  <dd className="mt-1 text-xs text-[var(--j-muted)]">{s.label}</dd>
                </div>
              ))}
            </dl>
            {/* Where the numbers come from. Nothing until the first answer, so no false "offline" flash. */}
            <p className="j-mono mt-3 flex min-h-4 items-center gap-2 text-[10.5px] tracking-wide text-[var(--j-faint)]" aria-live="polite">
              {online === true && (
                <>
                  <span className="inline-block size-1.5 rounded-full bg-[var(--j-success)]" /> live from the orchestrator
                  {summary?.plan?.projection?.projected_finish ? ` · projected finish ${fmtMonth(summary.plan.projection.projected_finish)}` : ''}
                </>
              )}
              {online === false && <>orchestrator offline — showing the last recorded run</>}
            </p>
          </div>

          <div data-hero-fade className="md:col-span-1 md:col-start-12 md:justify-self-end">
            <button
              type="button"
              onClick={() => scrollToTarget(lenis, '#pipeline')}
              data-cursor="Begin"
              className="group flex items-center gap-3 md:flex-col"
              aria-label="Scroll to begin the pipeline journey"
            >
              <span className="relative block h-14 w-px overflow-hidden bg-[var(--j-line-strong)]">
                <span data-cue-dot className="absolute left-0 top-0 block h-3 w-px bg-[var(--j-fg)]" />
              </span>
              <span className="j-eyebrow whitespace-nowrap transition-colors group-hover:text-[var(--j-fg)] md:[writing-mode:vertical-rl]">Scroll to begin</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
