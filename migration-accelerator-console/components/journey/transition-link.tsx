'use client'

import { motion, useAnimate } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext } from 'react'

// ---------------------------------------------------------------------------
// Route transitions (Framer Motion only). Leaving /journey through a
// TransitionLink raises a curtain first and navigates once it covers the
// screen; the entrance is handled by app/journey/template.tsx.
// ---------------------------------------------------------------------------

type Navigate = (href: string) => void
const CurtainContext = createContext<Navigate | null>(null)

export function RouteCurtain({ children }: { children: React.ReactNode }) {
  const [scope, animate] = useAnimate()
  const router = useRouter()

  const navigate = useCallback<Navigate>(
    async (href) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return router.push(href)
      router.prefetch(href)
      await animate(scope.current, { scaleY: [0, 1] }, { duration: 0.75, ease: [0.76, 0, 0.24, 1] }) // power4.inOut
      router.push(href)
    },
    [animate, router, scope],
  )

  return (
    <CurtainContext.Provider value={navigate}>
      {children}
      <motion.div
        ref={scope}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[90] origin-bottom bg-[var(--j-accent)]"
        style={{ scaleY: 0 }}
      />
    </CurtainContext.Provider>
  )
}

export function TransitionLink({ href, onClick, ...props }: React.ComponentProps<typeof Link> & { href: string }) {
  const navigate = useContext(CurtainContext)
  return (
    <Link
      href={href}
      {...props}
      onClick={(e) => {
        onClick?.(e)
        // Let modified clicks (new tab, etc.) behave normally.
        if (!navigate || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        navigate(href)
      }}
    />
  )
}
