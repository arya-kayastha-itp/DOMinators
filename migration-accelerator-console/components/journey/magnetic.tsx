'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/journey/gsap'
import { useFinePointer, useReducedMotion } from '@/lib/journey/use-media'

/** Pulls its child toward the pointer while hovered, then eases it home.
 *  The inner layer moves further than the outer for a subtle parallax. */
export function Magnetic({ children, strength = 0.35, className = '' }: { children: React.ReactNode; strength?: number; className?: string }) {
  const outer = useRef<HTMLSpanElement>(null)
  const inner = useRef<HTMLSpanElement>(null)
  const fine = useFinePointer()
  const reduced = useReducedMotion()

  useGSAP(
    () => {
      const el = outer.current
      if (!el || !inner.current || !fine || reduced) return
      // quickTo reuses one tween per axis instead of creating one per pointermove.
      const ox = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'expo.out' })
      const oy = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'expo.out' })
      const ix = gsap.quickTo(inner.current, 'x', { duration: 0.6, ease: 'expo.out' })
      const iy = gsap.quickTo(inner.current, 'y', { duration: 0.6, ease: 'expo.out' })

      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        ox(dx * strength)
        oy(dy * strength)
        ix(dx * strength * 0.35)
        iy(dy * strength * 0.35)
      }
      const leave = () => {
        gsap.to([el, inner.current], { x: 0, y: 0, duration: 1.1, ease: 'expo.out', overwrite: true })
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerleave', leave)
      return () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerleave', leave)
      }
    },
    { dependencies: [fine, reduced, strength] },
  )

  return (
    <span ref={outer} className={`inline-block ${className}`}>
      <span ref={inner} className="inline-block">
        {children}
      </span>
    </span>
  )
}
