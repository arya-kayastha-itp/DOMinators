'use client'

import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { createContext, useContext, useEffect, useState } from 'react'
import { gsap, ScrollTrigger } from '@/lib/journey/gsap'
import { useReducedMotion } from '@/lib/journey/use-media'

const LenisContext = createContext<Lenis | null>(null)

/** The page's Lenis instance, or null when smooth scrolling is off (reduced motion). */
export const useLenis = () => useContext(LenisContext)

/** Scroll to a target with Lenis when it's running, otherwise natively. */
export function scrollToTarget(lenis: Lenis | null, target: string | HTMLElement) {
  if (lenis) {
    lenis.scrollTo(target, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) })
    return
  }
  const el = typeof target === 'string' ? document.querySelector(target) : target
  el?.scrollIntoView({ block: 'start' })
}

/** `paused` locks scrolling (preloader, open dialog) with or without Lenis. */
export function SmoothScroll({ children, paused = false }: { children: React.ReactNode; paused?: boolean }) {
  const reduced = useReducedMotion()
  const [lenis, setLenis] = useState<Lenis | null>(null)

  // Always start at the top: the preloader, hero intro and pinned timelines
  // all assume a fresh scroll position.
  useEffect(() => {
    const prev = history.scrollRestoration
    history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)
    return () => void (history.scrollRestoration = prev)
  }, [])

  useEffect(() => {
    const html = document.documentElement
    if (paused) {
      lenis?.stop()
      html.style.overflow = 'hidden'
    } else {
      lenis?.start()
      html.style.overflow = ''
    }
    return () => void (html.style.overflow = '')
  }, [paused, lenis])

  useEffect(() => {
    // Reduced motion: native scrolling only, no inertia. Also read the media
    // query directly: on the first client render the hook still reports the
    // server value (false), and Lenis must never start in that window.
    if (reduced || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const instance = new Lenis({ lerp: 0.09, wheelMultiplier: 1, touchMultiplier: 1.4, autoRaf: false })

    // Keep ScrollTrigger in lockstep with Lenis: every Lenis scroll event
    // updates ScrollTrigger, and Lenis is driven by GSAP's ticker, so pinned
    // sections, scrubbed timelines and the smooth scroll share one frame loop.
    instance.on('scroll', ScrollTrigger.update)
    const tick = (time: number) => instance.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    setLenis(instance)
    return () => {
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33)
      instance.destroy()
      setLenis(null)
    }
  }, [reduced])

  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>
}
