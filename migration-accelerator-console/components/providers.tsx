'use client'

import { Tooltip } from '@base-ui/react/tooltip'
import { MotionConfig } from 'framer-motion'
import { ThemeProvider, useTheme } from 'next-themes'
import { Toaster } from 'sonner'

function ThemedToaster() {
  const { resolvedTheme } = useTheme()
  return (
    <Toaster
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{ classNames: { toast: 'font-sans !rounded-xl !border-border', description: '!text-muted-foreground' } }}
    />
  )
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user">
        <Tooltip.Provider delay={250}>
          {children}
          <ThemedToaster />
        </Tooltip.Provider>
      </MotionConfig>
    </ThemeProvider>
  )
}
