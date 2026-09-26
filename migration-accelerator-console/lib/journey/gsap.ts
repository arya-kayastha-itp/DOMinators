'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

// ---------------------------------------------------------------------------
// One place that registers every GSAP plugin the journey page uses. Import
// gsap from here (never from 'gsap' directly) so registration always happens
// before a component builds its first tween.
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP, ScrollTrigger, MotionPathPlugin, SplitText)
  // House easing: nothing linear except scrubbed timelines, which set ease: 'none'.
  gsap.defaults({ ease: 'expo.out', duration: 0.9 })
}

export const EASE_OUT = 'expo.out'
export const EASE_IN_OUT = 'power4.inOut'

export { gsap, MotionPathPlugin, ScrollTrigger, SplitText, useGSAP }
