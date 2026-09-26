'use client'

import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EASE_IN_OUT, EASE_OUT, gsap } from '@/lib/journey/gsap'
import { PIPELINE } from '@/lib/journey/pipeline'
import { useStages } from '@/lib/journey/use-live'
import { useReducedMotion } from '@/lib/journey/use-media'
import { Magnetic } from './magnetic'

// ---------------------------------------------------------------------------
// Stage deep dive — a shared-element FLIP transition, done by hand.
//
// The node's disc and this panel's full-screen disc share a data-flip-id.
//   First:  the caller measures the node disc *before* the panel mounts.
//   Last:   the panel disc's resting box (a circle the size of the viewport
//           diagonal, centred on screen).
//   Invert: the translate + uniform scale that puts Last exactly on First.
//   Play:   tween that transform back to identity.
// Both shapes are circles, so the morph is one translate + scale: transforms
// only. Closing runs the same maths towards the node disc's current box.
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')
export const discFor = (id: string) => document.querySelector<HTMLElement>(`[data-node] [data-flip-id="stage-${id}"]`)

function inViewport(el: HTMLElement | null) {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight
}

/** Transform that maps the disc's untransformed box onto `to`. */
function invert(disc: HTMLElement, frame: HTMLElement, to: DOMRect) {
  const f = frame.getBoundingClientRect() // disc is centred in the fixed frame
  return {
    x: to.left + to.width / 2 - (f.left + f.width / 2),
    y: to.top + to.height / 2 - (f.top + f.height / 2),
    scale: to.width / disc.offsetWidth,
  }
}

export function StagePanel({ index, origin, onClosed }: { index: number; origin: DOMRect | null; onClosed: () => void }) {
  const reduced = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const discRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const closing = useRef(false)
  const [current, setCurrent] = useState(index)
  const stage = useStages()[current]
  const Icon = stage.icon

  // OPEN — runs before paint so the disc never flashes at full size.
  useLayoutEffect(() => {
    const disc = discRef.current
    const content = contentRef.current
    if (!disc || !content) return
    const items = content.querySelectorAll('[data-panel-item]')
    // Focus can only land once the content is visible (autoAlpha hides it).
    const focusClose = () => closeRef.current?.focus({ preventScroll: true })
    const ctx = gsap.context(() => {
      if (reduced || !origin || !rootRef.current) {
        gsap.fromTo(rootRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: 'power1.out', onStart: () => requestAnimationFrame(focusClose) })
        return
      }
      gsap.set(content, { autoAlpha: 0 })
      // Invert onto the node, then play back to identity.
      gsap.fromTo(disc, invert(disc, rootRef.current, origin), { x: 0, y: 0, scale: 1, duration: 1, ease: EASE_IN_OUT })
      gsap.set(content, { autoAlpha: 1, delay: 0.55, onComplete: focusClose })
      // opacity (not autoAlpha) so the close button stays focusable while it fades in.
      gsap.fromTo(items, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1.1, stagger: 0.06, delay: 0.6, ease: EASE_OUT })
    }, rootRef)
    return () => ctx.revert()
    // Only on mount: switching stages inside the panel is handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // CLOSE — content out, then the disc collapses back onto its node.
  const close = () => {
    if (closing.current) return
    closing.current = true
    const disc = discRef.current
    const nodeDisc = discFor(stage.id)
    const done = () => {
      onClosed()
      // The page stops being inert on the next render; return focus after it.
      requestAnimationFrame(() => nodeDisc?.closest('button')?.focus({ preventScroll: true }))
    }
    if (reduced || !disc || !rootRef.current || !nodeDisc || !inViewport(nodeDisc)) {
      gsap.to(rootRef.current, { autoAlpha: 0, duration: 0.4, ease: 'power1.out', onComplete: done })
      return
    }
    gsap
      .timeline({ onComplete: done })
      .to(contentRef.current, { autoAlpha: 0, duration: 0.3, ease: 'power2.in' })
      .to(disc, { ...invert(disc, rootRef.current, nodeDisc.getBoundingClientRect()), duration: 0.85, ease: EASE_IN_OUT })
      .to(disc, { autoAlpha: 0, duration: 0.2 }, '-=0.12')
  }

  // Prev/next inside the panel: quick crossfade of the content only.
  const go = (dir: 1 | -1) => {
    const next = (current + dir + PIPELINE.length) % PIPELINE.length
    const items = contentRef.current?.querySelectorAll('[data-panel-item]')
    if (!items || reduced) return setCurrent(next)
    // opacity only, so whichever button was pressed keeps keyboard focus.
    gsap.to(items, {
      opacity: 0,
      y: -16 * dir,
      duration: 0.25,
      stagger: 0.02,
      ease: 'power2.in',
      onComplete: () => {
        setCurrent(next)
        requestAnimationFrame(() =>
          gsap.fromTo(
            contentRef.current!.querySelectorAll('[data-panel-item]'),
            { opacity: 0, y: 24 * dir },
            { opacity: 1, y: 0, duration: 0.8, stagger: 0.04, ease: EASE_OUT },
          ),
        )
      },
    })
  }

  // Keyboard: Esc closes, arrows switch stage, Tab stays inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'Tab' && rootRef.current) {
        const f = rootRef.current.querySelectorAll<HTMLElement>('button, a[href]')
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus())
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="panel-title" className="fixed inset-0 z-[80]">
      {/* The shared element. Diagonal-sized circle so it covers any viewport. */}
      <div
        ref={discRef}
        data-flip-id={`stage-${stage.id}`}
        className="absolute left-1/2 top-1/2 rounded-full bg-[var(--j-accent)]"
        // Centred with margins, not CSS translate, so Flip owns the only transform.
        style={{ '--d': 'max(150vw, 150vh)', width: 'var(--d)', height: 'var(--d)', marginLeft: 'calc(var(--d) / -2)', marginTop: 'calc(var(--d) / -2)' } as React.CSSProperties}
        aria-hidden
      />

      <div ref={contentRef} data-lenis-prevent className="absolute inset-0 overflow-y-auto bg-[var(--j-bg)]">
        <div className="pointer-events-none absolute -right-40 -top-40 size-[60vmax] rounded-full bg-[radial-gradient(closest-side,oklch(0.72_0.21_293/0.22),transparent)]" aria-hidden />

        <div className="relative mx-auto flex min-h-full max-w-[1680px] flex-col px-4 pb-10 pt-6 sm:px-8 lg:px-12">
          <div data-panel-item className="flex items-center justify-between">
            <span className="j-mono text-[11px] uppercase tracking-[0.18em] text-[var(--j-muted)]">
              Stage <span className="text-[var(--j-fg)]">{pad(current + 1)}</span> / {pad(PIPELINE.length)} · deep dive
            </span>
            <Magnetic>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                data-cursor="Close"
                aria-label="Close deep dive"
                className="grid size-14 place-items-center rounded-full border border-[var(--j-line-strong)] transition-colors hover:border-[var(--j-fg)]"
              >
                <X className="size-5" />
              </button>
            </Magnetic>
          </div>

          <div className="mt-10 grid flex-1 grid-cols-1 gap-12 md:mt-16 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div data-panel-item className="flex items-center gap-4">
                <span className="grid size-14 place-items-center rounded-full bg-[var(--j-accent)] text-[var(--j-bg)]">
                  <Icon className="size-6" aria-hidden />
                </span>
                <span className="j-eyebrow">{stage.kicker}</span>
              </div>
              <h2 id="panel-title" data-panel-item className="mt-6 text-[clamp(3rem,9vw,9.5rem)] font-semibold leading-[0.88] tracking-[-0.055em]">
                {stage.name}
              </h2>
              <p data-panel-item className="mt-8 max-w-2xl text-lg leading-relaxed text-[var(--j-muted)] md:text-2xl md:leading-snug">
                {stage.description}
              </p>

              <div data-panel-item className="mt-10 grid max-w-2xl grid-cols-1 gap-6 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
                <IOBlock label="Input" items={stage.input} />
                <ArrowRight className="hidden size-6 text-[var(--j-accent)] sm:mt-9 sm:block" aria-hidden />
                <IOBlock label="Output" items={stage.output} />
              </div>
            </div>

            <div className="lg:col-span-4 lg:col-start-9">
              <div data-panel-item className="border-t border-[var(--j-line-strong)] pt-5">
                <div className="text-[clamp(3rem,6vw,5.5rem)] font-semibold leading-none tracking-[-0.05em] text-[var(--j-accent)]">{stage.metric.value}</div>
                <div className="mt-2 text-sm text-[var(--j-muted)]">{stage.metric.label}</div>
              </div>
              <ol className="mt-10 flex flex-col">
                {stage.details.map((d, k) => (
                  <li key={d} data-panel-item className="grid grid-cols-[36px_1fr] gap-2 border-t border-[var(--j-line)] py-4 text-[15px] leading-relaxed">
                    <span className="j-mono text-[11px] leading-6 text-[var(--j-faint)]">{pad(k + 1)}</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div data-panel-item className="mt-14 flex items-center justify-between border-t border-[var(--j-line)] pt-6">
            <button type="button" onClick={() => go(-1)} data-cursor="Prev" className="group flex items-center gap-3 text-sm">
              <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" aria-hidden />
              <span className="text-[var(--j-muted)]">Previous</span> {PIPELINE[(current - 1 + PIPELINE.length) % PIPELINE.length].name}
            </button>
            <button type="button" onClick={() => go(1)} data-cursor="Next" className="group flex items-center gap-3 text-sm">
              {PIPELINE[(current + 1) % PIPELINE.length].name} <span className="text-[var(--j-muted)]">Next</span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function IOBlock({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="j-eyebrow mb-3">{label}</div>
      <ul className="flex flex-col gap-2">
        {items.map((it) => (
          <li key={it} className="j-chip w-fit max-w-full !px-3.5 !py-2 !text-[13px] [overflow-wrap:anywhere]">
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}
