'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Bomb, ChevronDown, Layers3, Loader2, Play, Radar, RotateCcw, Rocket, ShieldCheck, Trash2, Wand2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useConsole } from '@/components/console/console-provider'

const DEMO_APP = 'app-catalog'
const BAD_WAVE_APP = 'app-orders'

type Action = { run: () => void; disabled: string | null; busy: boolean }

// The stage-demo actions, shared by the demo dock and the command palette.
// Each action calls the live orchestrator through the console provider;
// `disabled` is a human-readable reason (or null) so both surfaces can explain it.
export function useDemoActions() {
  const c = useConsole()
  const router = useRouter()
  const running = c.demo?.running ?? []
  const offline = c.online ? null : 'Orchestrator offline'
  const resetting = running.some(r => r === 'reset' || r.startsWith('reset:'))
  const busyList = running.length ? `Busy: ${running.join(', ')}` : null
  const appRunning = running.some(r => /^(blueprint|retry|cutover|wave):/.test(r))
  const cap = c.demo?.capabilities?.[DEMO_APP]
  const discovered = !!c.summary?.discovered
  const hasDemoApp = c.fleetById.has(DEMO_APP)

  const go = (p: Promise<boolean>, href?: string) => { p.then(ok => { if (ok && href) router.push(href) }) }

  const discovery: Action = {
    disabled: offline ?? busyList,
    busy: c.isRunning('discovery'),
    run: () => go(c.runDiscovery(), '/fleet'),
  }
  const planning: Action = {
    disabled: offline ?? (resetting || c.isRunning('discovery') ? 'Discovery / reset in progress' : c.isRunning('planning') ? 'Planning in progress' : !discovered ? 'Run discovery first' : null),
    busy: c.isRunning('planning'),
    run: () => go(c.runPlanning(), '/plan'),
  }
  const appBlock = offline ?? (resetting ? 'Reset in progress' : !hasDemoApp ? 'Run discovery first' : c.isRunning(DEMO_APP) ? `${DEMO_APP} is busy` : null)
  const blueprint: Action = {
    disabled: appBlock ?? (cap && !cap.provision ? cap.reason ?? `${DEMO_APP} cannot be provisioned` : null),
    busy: running.some(r => r === `blueprint:${DEMO_APP}` || r === `retry:${DEMO_APP}`),
    run: () => go(c.runBlueprint(DEMO_APP, true), `/blueprint?app=${DEMO_APP}`),
  }
  const cutover: Action = {
    disabled: appBlock ?? (cap && !cap.cutover ? cap.reason ?? `${DEMO_APP} has no cutover path` : null),
    busy: running.includes(`cutover:${DEMO_APP}`),
    run: () => go(c.runCutover(DEMO_APP), `/cutover?app=${DEMO_APP}`),
  }
  const wave: Action = {
    disabled: offline ?? (resetting ? 'Reset in progress' : !c.plan ? 'Build a wave plan first' : appRunning ? busyList : null),
    busy: running.includes('wave:0'),
    run: () => go(c.runWave(0), `/cutover?app=${DEMO_APP}`),
  }
  const badWave: Action = {
    disabled: offline,
    busy: false,
    run: () => { c.setBadWave(!c.badWave, BAD_WAVE_APP) },
  }
  const reset: Action = {
    disabled: offline ?? busyList,
    busy: resetting,
    run: () => go(c.reset(false), '/'),
  }
  const destroy: Action = {
    disabled: offline ?? busyList,
    busy: resetting,
    run: () => {
      const ok = window.confirm('Reset the demo AND destroy the target instances in Account B (terraform destroy)?\n\nThis deletes real AWS resources. Re-provisioning takes a few minutes.')
      if (ok) go(c.reset(true), '/')
    },
  }

  const wave0 = c.plan?.waves.find(w => w.wave === 0)
  const realSet = new Set(c.realAppIds)
  const wave0Real = wave0?.app_ids.filter(id => realSet.has(id)) ?? []
  const wave0Apps = wave0 ? (wave0Real.length ? wave0Real.join(', ') : `${wave0.app_ids.length} apps`) : undefined

  return { discovery, planning, blueprint, cutover, wave, badWave, reset, destroy, badWaveOn: c.badWave, wave0Apps }
}

const btn = 'flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-left text-xs font-medium transition hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0'

function Btn({ action, icon, label, className, pressed }: { action: Action; icon: React.ReactNode; label: React.ReactNode; className?: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      className={cn(btn, className)}
      disabled={!!action.disabled}
      title={action.disabled ?? undefined}
      aria-pressed={pressed}
      aria-busy={action.busy || undefined}
      onClick={action.run}
    >
      {action.busy ? <Loader2 className="animate-spin" aria-hidden /> : icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

// Operator controls for the stage demo (behind ?demo=1), in the demo-script order.
export function DemoDock() {
  const a = useDemoActions()
  const [open, setOpen] = useState(true)

  return (
    <div className="fixed bottom-4 left-4 z-40 w-[272px]" role="region" aria-label="Demo controls">
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
                <Btn action={a.discovery} icon={<Radar />} label="Discovery" />
                <Btn action={a.planning} icon={<Layers3 />} label="Build plan" />
                <Btn action={a.blueprint} icon={<ShieldCheck />} label="Blueprint + apply" />
                <Btn action={a.cutover} icon={<Rocket />} label="Cut over" />
                <Btn action={a.wave} icon={<Play />} label={<>Run wave 0{a.wave0Apps ? <span className="font-normal text-muted-foreground"> · {a.wave0Apps}</span> : null}</>} className="col-span-2" />
                <Btn action={a.badWave} icon={<Bomb />} label={`Bad wave ${a.badWaveOn ? 'ON' : 'off'}`} pressed={a.badWaveOn} className={cn(a.badWaveOn && 'border-destructive/40 bg-destructive/10 text-destructive')} />
                <Btn action={a.reset} icon={<RotateCcw />} label="Reset" />
                <Btn action={a.destroy} icon={<Trash2 />} label="Reset + destroy target" className="col-span-2 border-destructive/30 text-destructive hover:border-destructive/60" />
              </div>
              {a.discovery.disabled && <p className="px-3 pb-2.5 text-[10.5px] text-subtle">{a.discovery.disabled}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
