'use client'

import { Command } from 'cmdk'
import { Bomb, Boxes, CornerDownLeft, Layers3, Moon, Play, Radar, RotateCcw, Rocket, ShieldCheck, Sparkles, Sun, Trash2 } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { NAV, TIER_COLOR_VAR } from '@/components/console/bits'
import { useConsole } from '@/components/console/console-provider'
import { Kbd } from '@/components/ui/primitives'
import { useShell } from './app-shell'
import { useDemoActions } from './demo-dock'

const item = 'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] text-foreground aria-selected:bg-surface-2 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:text-subtle'
const group = 'px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-subtle [&_[cmdk-group-items]]:mt-1.5'

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter()
  const { fleet } = useConsole()
  const a = useDemoActions()
  const { openCopilot } = useShell()
  const { resolvedTheme, setTheme } = useTheme()
  const [query, setQuery] = useState('')

  const appResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) {
      const real = fleet.filter(x => x.source === 'real')
      return (real.length ? real : fleet).slice(0, 5)
    }
    return fleet.filter(x => `${x.app_id} ${x.name} ${x.owner ?? ""} ${x.business_unit ?? ""}`.toLowerCase().includes(q)).slice(0, 8)
  }, [query, fleet])

  const run = (fn: () => void) => { onOpenChange(false); setQuery(''); fn() }
  const hint = (reason: string | null, fallback?: string) => <span className="ml-auto truncate text-xs text-subtle">{reason ?? fallback}</span>

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
          <Command.Group heading="Copilot" className={group}>
            <Command.Item value={`ask ${query}`} onSelect={() => run(() => openCopilot(query))} className={item}>
              <Sparkles className="!text-primary" /> Ask Copilot: <span className="truncate text-muted-foreground">&ldquo;{query}&rdquo;</span>
            </Command.Item>
          </Command.Group>
        )}

        <Command.Group heading="Actions" className={group}>
          <Command.Item value="run discovery scan account a" disabled={!!a.discovery.disabled} onSelect={() => run(a.discovery.run)} className={item}>
            <Radar /> Run discovery {hint(a.discovery.disabled, 'Account A + synthetic fleet')}
          </Command.Item>
          <Command.Item value="build wave plan planning" disabled={!!a.planning.disabled} onSelect={() => run(a.planning.run)} className={item}>
            <Layers3 /> Build wave plan {hint(a.planning.disabled)}
          </Command.Item>
          <Command.Item value="blueprint apply terraform app-catalog" disabled={!!a.blueprint.disabled} onSelect={() => run(a.blueprint.run)} className={item}>
            <ShieldCheck /> Blueprint + apply — app-catalog {hint(a.blueprint.disabled, 'terraform apply in Account B')}
          </Command.Item>
          <Command.Item value="cut over cutover app-catalog" disabled={!!a.cutover.disabled} onSelect={() => run(a.cutover.run)} className={item}>
            <Rocket /> Cut over app-catalog {hint(a.cutover.disabled, 'live ALB weights')}
          </Command.Item>
          <Command.Item value="run wave 0" disabled={!!a.wave.disabled} onSelect={() => run(a.wave.run)} className={item}>
            <Play /> Run wave 0 {hint(a.wave.disabled, a.wave0Apps)}
          </Command.Item>
          <Command.Item value="toggle bad wave app-orders" disabled={!!a.badWave.disabled} onSelect={() => run(a.badWave.run)} className={item}>
            <Bomb /> {a.badWaveOn ? 'Disable' : 'Enable'} bad wave for app-orders {hint(a.badWave.disabled)}
          </Command.Item>
          <Command.Item value="reset demo" disabled={!!a.reset.disabled} onSelect={() => run(a.reset.run)} className={item}>
            <RotateCcw /> Reset demo {hint(a.reset.disabled, 'keeps target instances')}
          </Command.Item>
          <Command.Item value="reset destroy target instances" disabled={!!a.destroy.disabled} onSelect={() => run(a.destroy.run)} className={item}>
            <Trash2 className="!text-destructive" /> <span className="text-destructive">Reset + destroy target instances</span> {hint(a.destroy.disabled, 'deletes AWS resources')}
          </Command.Item>
          <Command.Item value="toggle theme dark light mode" onSelect={() => run(() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light'))} className={item}>
            {resolvedTheme === 'light' ? <Moon /> : <Sun />} Switch to {resolvedTheme === 'light' ? 'dark' : 'light'} mode
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Navigate" className={group}>
          {NAV.map(({ href, label, icon: Icon, description }) => (
            <Command.Item key={href} value={`go ${label} ${description}`} onSelect={() => run(() => router.push(href))} className={item}>
              <Icon /> {label} <span className="ml-auto truncate text-xs text-subtle">{description}</span>
            </Command.Item>
          ))}
        </Command.Group>

        {appResults.length > 0 && (
          <Command.Group heading="Apps" className={group}>
            {appResults.map(x => (
              <Command.Item key={x.app_id} value={`${x.app_id} ${x.name} ${x.owner} ${x.business_unit}`} onSelect={() => run(() => router.push(`/fleet?q=${encodeURIComponent(x.app_id)}`))} className={item}>
                <Boxes />
                <span className="font-mono text-xs">{x.app_id}</span>
                <span className="truncate text-muted-foreground">{x.name}</span>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-subtle">
                  {x.source === 'real' && <span className="font-mono text-[10px] uppercase tracking-wider text-primary">live</span>}
                  {x.tier && <><span className="size-1.5 rounded-full" style={{ background: TIER_COLOR_VAR[x.tier] }} />{x.tier}</>}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
      <div className="flex items-center gap-4 border-t px-4 py-2 text-[11px] text-subtle">
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
        <span className="flex items-center gap-1"><Kbd><CornerDownLeft className="size-3" /></Kbd> select</span>
        <span className="ml-auto flex items-center gap-1"><Kbd>Ctrl J</Kbd> Copilot</span>
      </div>
    </Command.Dialog>
  )
}
