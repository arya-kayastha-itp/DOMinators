'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Bomb, ChevronDown, Layers3, Loader2, Play, Radar, RotateCcw, Rocket, ShieldCheck, Wand2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useConsole } from '@/components/console/console-provider'

// Operator controls for the stage demo (behind ?demo=1), in the DEMO_SCRIPT order.
export function DemoDock() {
  const c = useConsole()
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const busy = (k: keyof typeof c.agents) => c.agents[k] === 'running'
  const btn = 'flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-left text-xs font-medium transition hover:border-border-strong disabled:opacity-50 [&_svg]:size-3.5'

  return (
    <div className="fixed bottom-4 left-4 z-40 w-[260px]" role="region" aria-label="Demo controls">
      <div className="glass overflow-hidden rounded-2xl border shadow-elev-3">
        <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold" aria-expanded={open}>
          <Wand2 className="size-3.5 text-warning" /> Demo controls
          <span className="ml-1 rounded-full bg-warning/15 px-1.5 text-[10px] font-medium text-warning">operator</span>
          <ChevronDown className={cn('ml-auto size-3.5 transition', !open && '-rotate-90')} />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
              <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
                <button className={btn} disabled={busy('discovery')} onClick={() => { c.runDiscovery(); router.push('/fleet') }}>{busy('discovery') ? <Loader2 className="animate-spin" /> : <Radar />} Discovery</button>
                <button className={btn} disabled={busy('planning')} onClick={() => { c.runPlanning(); router.push('/plan') }}>{busy('planning') ? <Loader2 className="animate-spin" /> : <Layers3 />} Build plan</button>
                <button className={btn} disabled={busy('blueprint')} onClick={() => { c.runBlueprint('app-catalog', true); router.push('/blueprint?app=app-catalog') }}>{busy('blueprint') ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Blueprint</button>
                <button className={btn} disabled={busy('cutover')} onClick={() => { c.runCutover('app-catalog'); router.push('/cutover?app=app-catalog') }}>{busy('cutover') ? <Loader2 className="animate-spin" /> : <Rocket />} Cut over</button>
                <button className={cn(btn, 'col-span-2')} disabled={busy('cutover') || busy('blueprint')} onClick={() => { c.runWave1(); router.push('/cutover?app=app-orders') }}><Play /> Run wave 1 · app-orders</button>
                <button className={cn(btn, c.badWave && 'border-destructive/40 bg-destructive/10 text-destructive')} onClick={() => c.setBadWave(!c.badWave)} aria-pressed={c.badWave}><Bomb /> Bad wave {c.badWave ? 'ON' : 'off'}</button>
                <button className={btn} onClick={c.reset}><RotateCcw /> Reset</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
