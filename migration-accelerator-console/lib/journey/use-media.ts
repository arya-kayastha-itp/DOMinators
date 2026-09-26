'use client'

import { useSyncExternalStore } from 'react'

// Subscribes to a CSS media query. The server snapshot is `serverValue`, so the
// first client render matches SSR and the real value arrives right after hydration.
export function useMedia(query: string, serverValue = false) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  )
}

export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)')
/** Desktop = wide viewport with a precise pointer: gets pinning, horizontal track, WebGL and the custom cursor. */
export const useDesktop = () => useMedia('(min-width: 1024px) and (pointer: fine)')
export const useFinePointer = () => useMedia('(pointer: fine)')
