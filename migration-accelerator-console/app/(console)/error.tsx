'use client'

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useEffect } from 'react'

export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <div role="alert" className="surface mx-auto mt-10 max-w-lg p-8 text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><AlertTriangle className="size-5" /></div>
      <h2 className="mt-4 text-base font-semibold">This view hit an error</h2>
      <p className="mt-1 text-sm text-muted-foreground">Nothing was changed in either AWS account. Retry the view — state lives in the console, not the page.</p>
      <p className="mt-3 font-mono text-xs text-subtle">{error.message}</p>
      <button onClick={reset} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground"><RotateCcw className="size-4" /> Retry</button>
    </div>
  )
}
