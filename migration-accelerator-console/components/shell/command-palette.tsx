'use client'

import { Command } from 'cmdk'
import { Bomb, Boxes, CornerDownLeft, Layers3, Moon, Play, Radar, RotateCcw, Rocket, ShieldCheck, Sparkles, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { fleet } from '@/lib/data/fleet'
import { NAV, TIER_COLOR_VAR } from '@/components/console/bits'
import { useConsole } from '@/components/console/console-provider'
import { Kbd } from '@/components/ui/primitives'
import { useShell } from './app-shell'

const item = 'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] text-foreground aria-selected:bg-surface-2 data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:text-subtle'

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter()
  const c = useConsole()
  const { openCopilot } = useShell()
  const { resolvedTheme, setTheme } = useTheme()
  const [query, setQuery] = useState('')

  const appResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return fleet.slice(0, 3)
    return fleet.filter(a => `${a.app_id} ${a.name} ${a.owner} ${a.business_unit}`.toLowerCase().includes(q)).slice(0, 8)
  }, [query])

  const run = (fn: () => void) => { onOpenChange(false); setQuery(''); fn() }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={v => { onOpenChange(v); if (!v) setQuery('') }}
      label="Command palette"
      shouldFilter
      overlayClassName="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-elev-3"
    >
      <div className="flex items-center gap-2 border-b px-4">
        <Sparkles className="size-4 text-primary" />
        <Command.Input value={query} onValueChange={setQuery} placeholder="Type a command, page or app id…" className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle" />
        <Kbd>Esc</Kbd>
      </div>
      <Command.List className="scrollbar-thin max-h-[min(60vh,440px)] overflow-y-auto p-2">
        <Command.Empty className="py-10 text-center text-sm text-muted-foreground">
          No matches. <button className="text-primary underline-offset-4 hover:underline" onClick={() => run(() => openCopilot(query))}>Ask Copilot instead →</button>
        </Command.Empty>

        {query.trim().length > 3 && (
          <Command.Group heading="Copilot" className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-subtle [&_[cmdk-group-items]]:mt-1.5">
            <Command.Item value={`ask ${query}`} onSelect={() => run(() => openCopilot(query))} className={item}>
              <Sparkles className="!text-primary" /> Ask Copilot: <span className="truncate text-muted-foreground">&ldquo;{query}&rdquo;</span>
            </Command.Item>
          </Command.Group>
        )}

        <Command.Group heading="Actions" className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-subtle [&_[cmdk-group-items]]:mt-1.5">
          <Command.Item onSelect={() => run(c.runDiscovery)} className={item}><Radar /> Run discovery <span className="ml-auto text-xs text-subtle">Account A + synthetic</span></Command.Item>
          <Command.Item onSelect={() => run(() => { c.runPlanning(); router.push('/plan') })} className={item}><Layers3 /> Build wave plan</Command.Item>
          <Command.Item onSelect={() => run(() => { c.runBlueprint('app-catalog', true); router.push('/blueprint?app=app-catalog') })} className={item}><ShieldCheck /> Generate &amp; apply blueprint — app-catalog</Command.Item>
          <Command.Item onSelect={() => run(() => { c.runCutover('app-catalog'); router.push('/cutover?app=app-catalog') })} className={item}><Rocket /> Cut over app-catalog</Command.Item>
          <Command.Item onSelect={() => run(() => { c.runWave1(); router.push('/cutover?app=app-orders') })} className={item}><Play /> Run wave 1 (app-orders)</Command.Item>
          <Command.Item onSelect={() => run(() => c.setBadWave(!c.badWave))} className={item}><Bomb /> {c.badWave ? 'Disable' : 'Enable'} bad-wave variant</Command.Item>
          <Command.Item onSelect={() => run(c.reset)} className={item}><RotateCcw /> Reset demo</Command.Item>
          <Command.Item onSelect={() => run(() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light'))} className={item}>{resolvedTheme === 'light' ? <Moon /> : <Sun />} Switch to {resolvedTheme === 'light' ? 'dark' : 'light'} mode</Command.Item>
        </Command.Group>

        <Command.Group heading="Navigate" className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-subtle [&_[cmdk-group-items]]:mt-1.5">
          {NAV.map(({ href, label, icon: Icon, description }) => (
            <Command.Item key={href} value={`go ${label} ${description}`} onSelect={() => run(() => router.push(href))} className={item}>
              <Icon /> {label} <span className="ml-auto truncate text-xs text-subtle">{description}</span>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Apps" className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-subtle [&_[cmdk-group-items]]:mt-1.5">
          {appResults.map(a => (
            <Command.Item key={a.app_id} value={`${a.app_id} ${a.name} ${a.owner} ${a.business_unit}`} onSelect={() => run(() => router.push(`/fleet?q=${a.app_id}`))} className={item}>
              <Boxes />
              <span className="font-mono text-xs">{a.app_id}</span>
              <span className="truncate text-muted-foreground">{a.name}</span>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-subtle"><span className="size-1.5 rounded-full" style={{ background: TIER_COLOR_VAR[a.tier] }} />{a.tier}</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
      <div className="flex items-center gap-4 border-t px-4 py-2 text-[11px] text-subtle">
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
        <span className="flex items-center gap-1"><Kbd><CornerDownLeft className="size-3" /></Kbd> select</span>
        <span className="ml-auto flex items-center gap-1"><Kbd>Ctrl J</Kbd> Copilot</span>
      </div>
    </Command.Dialog>
  )
}
