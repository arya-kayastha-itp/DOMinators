'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/journey/gsap'
import { useFinePointer, useReducedMotion } from '@/lib/journey/use-media'

// ---------------------------------------------------------------------------
// Custom cursor: a dot that tracks the pointer tightly and a ring that trails
// it. Over anything with data-cursor="Label" the ring grows into a filled disc
// showing the label. The ring is authored at full size and scaled down at
// rest, so the label text stays crisp when it grows (transform only).
// ---------------------------------------------------------------------------

const REST = 0.42
const HOVER = 1
const EASE = 'expo.out'

export function Cursor({ rootRef }: { rootRef: React.RefObject<HTMLElement | null> }) {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const fine = useFinePointer()
  const reduced = useReducedMotion()
  const enabled = fine && !reduced

  useGSAP(
    () => {
      if (!enabled || !dot.current || !ring.current) return
      const host = rootRef.current
      host?.classList.add('has-cursor')

      gsap.set([dot.current, ring.current], { xPercent: -50, yPercent: -50, x: -100, y: -100 })
      gsap.set(ring.current, { scale: REST })
      const dx = gsap.quickTo(dot.current, 'x', { duration: 0.12, ease: 'power3.out' })
      const dy = gsap.quickTo(dot.current, 'y', { duration: 0.12, ease: 'power3.out' })
      const rx = gsap.quickTo(ring.current, 'x', { duration: 0.55, ease: EASE })
      const ry = gsap.quickTo(ring.current, 'y', { duration: 0.55, ease: EASE })

      let hovering: Element | null = null
      const onMove = (e: PointerEvent) => {
        dx(e.clientX)
        dy(e.clientY)
        rx(e.clientX)
        ry(e.clientY)
      }
      // Event delegation: one listener handles every interactive element.
      const onOver = (e: PointerEvent) => {
        const target = (e.target as Element).closest('[data-cursor], a, button')
        if (target === hovering) return
        hovering = target
        const text = target?.getAttribute('data-cursor')
        if (label.current) label.current.textContent = text ?? ''
        gsap.to(ring.current, { scale: target ? (text ? HOVER : 0.62) : REST, duration: 0.6, ease: EASE })
        gsap.to(fill.current, { opacity: text ? 1 : 0, duration: 0.35, ease: 'power2.out' })
        gsap.to(label.current, { opacity: text ? 1 : 0, duration: 0.3, delay: text ? 0.08 : 0 })
        gsap.to(dot.current, { scale: target ? 0 : 1, duration: 0.3, ease: 'power2.out' })
      }
      const onDown = () => gsap.to(ring.current, { scale: '-=0.08', duration: 0.2, ease: 'power2.out' })
      const onUp = () => gsap.to(ring.current, { scale: hovering ? (hovering.getAttribute('data-cursor') ? HOVER : 0.62) : REST, duration: 0.5, ease: EASE })
      const onLeave = () => gsap.to([dot.current, ring.current], { autoAlpha: 0, duration: 0.3 })
      const onEnter = () => gsap.to([dot.current, ring.current], { autoAlpha: 1, duration: 0.3 })

      window.addEventListener('pointermove', onMove, { passive: true })
      document.addEventListener('pointerover', onOver)
      window.addEventListener('pointerdown', onDown)
      window.addEventListener('pointerup', onUp)
      document.documentElement.addEventListener('pointerleave', onLeave)
      document.documentElement.addEventListener('pointerenter', onEnter)
      return () => {
        host?.classList.remove('has-cursor')
        window.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerover', onOver)
        window.removeEventListener('pointerdown', onDown)
        window.removeEventListener('pointerup', onUp)
        document.documentElement.removeEventListener('pointerleave', onLeave)
        document.documentElement.removeEventListener('pointerenter', onEnter)
      }
    },
    { dependencies: [enabled] },
  )

  if (!enabled) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-[95]" aria-hidden>
      <div ref={ring} className="absolute left-0 top-0 grid size-24 place-items-center rounded-full border border-white/70 mix-blend-difference">
        <div ref={fill} className="absolute inset-0 rounded-full bg-white opacity-0" />
        <span ref={label} className="j-mono relative text-[11px] font-medium uppercase tracking-[0.14em] text-black opacity-0" />
      </div>
      <div ref={dot} className="absolute left-0 top-0 size-1.5 rounded-full bg-white mix-blend-difference" />
    </div>
  )
}
