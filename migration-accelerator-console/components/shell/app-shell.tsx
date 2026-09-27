'use client'

import { Dialog } from '@base-ui/react/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeftRight, ChevronRight, Eye, Lock, Menu, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, Sparkles, Sun, LockOpen, WifiOff, X } from 'lucide-react'
import { useTheme } from 'next-themes'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { AgentName } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { NAV } from '@/components/console/bits'
import { useConsole, type AgentState } from '@/components/console/console-provider'
import { Kbd, Tip } from '@/components/ui/primitives'
import { CommandPalette } from './command-palette'
import { CopilotPanel } from './copilot-panel'
import { DemoDock } from './demo-dock'

type ShellCtx = { openPalette: () => void; openCopilot: (prompt?: string) => void }
const ShellContext = createContext<ShellCtx>({ openPalette: () => {}, openCopilot: () => {} })
export const useShell = () => useContext(ShellContext)

const GROUPS = ['Program', 'Discover', 'Plan', 'Execute', 'Govern'] as const

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname()
  const { fleet, statuses, realAppIds, demo } = useConsole()
  const realStatuses = realAppIds.map(id => statuses[id])
  const cuttingOver = realStatuses.includes('CUTTING_OVER')
  const rolledBack = realStatuses.includes('ROLLED_BACK')
  const running = demo?.running ?? []
  const badge: Record<string, React.ReactNode> = {
    '/cutover': cuttingOver
      ? <span className="live-dot size-1.5 text-warning" role="img" aria-label="Cutover in progress" />
      : rolledBack ? <span className="size-1.5 rounded-full bg-destructive" role="img" aria-label="An app was rolled back" /> : null,
    '/fleet': fleet.length > 0 ? <span className="font-mono text-[10px] text-subtle" aria-label={`${fleet.length} apps`}>{fleet.length.toLocaleString()}</span> : null,
    '/activity': running.length > 0 ? <span className="live-dot size-1.5 text-primary" role="img" aria-label={`Running: ${running.join(', ')}`} /> : null,
  }
  return (
    <nav aria-label="Primary" className="flex flex-col gap-5">
      {GROUPS.map(group => (
        <div key={group}>
          {!collapsed && <div className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.1em] text-subtle">{group}</div>}
          <ul className="flex flex-col gap-0.5">
            {NAV.filter(n => n.group === group).map(({ href, label, icon: Icon }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
              const link = (
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors',
                    active ? 'text-foreground' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                    collapsed && 'justify-center px-0',
                  )}
                >
                  {active && <motion.span layoutId="nav-active" className="absolute inset-0 -z-10 rounded-lg border bg-card shadow-elev-1" transition={{ type: 'spring', stiffness: 480, damping: 38 }} />}
                  {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary" />}
                  <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-subtle group-hover:text-foreground')} />
                  {!collapsed && <span className="flex-1 truncate">{label}</span>}
                  {!collapsed && badge[href]}
                </Link>
              )
              return <li key={href}>{collapsed ? <Tip content={label} side="right">{link}</Tip> : link}</li>
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg px-1" aria-label="Migration Accelerator home">
      <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-primary to-brand-2 text-primary-foreground shadow-elev-2">
        <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden><path d="M4 17l5-5 4 4 7-8" /><path d="M15 8h5v5" /></svg>
      </span>
      {!collapsed && (
        <span className="min-w-0 leading-tight">
          <span className="block text-[14px] font-semibold tracking-tight">Migration Accelerator</span>
          <span className="block text-[11px] text-subtle">Cloud 2.0 program</span>
        </span>
      )}
    </Link>
  )
}

function Sidebar({ collapsed, setCollapsed }: { collapsed: boolean; setCollapsed: (v: boolean) => void }) {
  return (
    <aside className={cn('sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 lg:flex', collapsed ? 'w-[68px]' : 'w-[248px]')}>
      <div className={cn('flex h-14 items-center border-b px-3', collapsed ? 'justify-center' : 'justify-between')}>
        <Brand collapsed={collapsed} />
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
        <NavList collapsed={collapsed} />
      </div>
      <div className="border-t p-3">
        {!collapsed && <AccountCard />}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn('mt-2 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground transition hover:bg-surface-2 hover:text-foreground', collapsed && 'justify-center')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse <Kbd className="ml-auto">[</Kbd></>}
        </button>
      </div>
    </aside>
  )
}

function AccountCard() {
  const { env, setEnv } = useConsole()
  const acct = env === 'target' ? { name: 'Account B · target', id: '408336117553', profile: 'mig-target' } : { name: 'Account A · legacy', id: '533266974611', profile: 'mig-legacy' }
  return (
    <button onClick={() => setEnv(env === 'target' ? 'legacy' : 'target')} className="flex w-full items-center gap-2.5 rounded-lg border bg-card p-2.5 text-left transition hover:border-border-strong" aria-label="Switch AWS account context">
      <span className={cn('size-2.5 shrink-0 rounded-sm', env === 'target' ? 'bg-target' : 'bg-legacy')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{acct.name}</span>
        <span className="block truncate font-mono text-[10.5px] text-subtle">{acct.profile} · {acct.id}</span>
      </span>
      <ArrowLeftRight className="size-3.5 text-subtle" />
    </button>
  )
}

const AGENT_ROWS: [AgentName, string][] = [['discovery', 'Discovery'], ['planning', 'Planning'], ['blueprint', 'Blueprint'], ['cutover', 'Cutover']]
const STATE_STYLE: Record<AgentState, string> = {
  idle: 'text-subtle',
  running: 'text-primary',
  done: 'text-success',
  error: 'text-destructive',
}
function PipelineRail() {
  const { agents } = useConsole()
  return (
    <div className="hidden items-center rounded-lg border bg-surface-2/60 p-0.5 xl:flex" aria-label="Agent pipeline status">
      {AGENT_ROWS.map(([key, label], i) => (
        <div key={key} className="flex items-center">
          <Tip content={`${label} agent · ${agents[key]}`}>
            <span className={cn('flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium', agents[key] === 'running' && 'bg-primary/10', STATE_STYLE[agents[key]])}>
              {agents[key] === 'running' ? <span className="live-dot size-1.5" /> : <span className={cn('size-1.5 rounded-full', agents[key] === 'idle' ? 'bg-border-strong' : 'bg-current')} />}
              <span className={agents[key] === 'idle' ? 'text-muted-foreground' : 'text-foreground'}>{label}</span>
            </span>
          </Tip>
          {i < AGENT_ROWS.length - 1 && <ChevronRight className="size-3 text-border-strong" />}
        </div>
      ))}
    </div>
  )
}

export function llmLabel(llm: { backend: string; model: string | null } | undefined) {
  if (!llm) return 'LLM: unknown'
  if (!llm.backend || llm.backend === 'off') return 'LLM: off (rules only)'
  return `LLM: ${llm.backend}${llm.model ? ` · ${llm.model}` : ''}`
}

const START_CMD = 'uvicorn orchestrator.main:app --port 8000'

function ConnectionStatus() {
  const { online, loading } = useConsole()
  if (loading && !online) return <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-border-strong" />Connecting to orchestrator…</span>
  return online
    ? <span className="flex items-center gap-1.5 text-success"><span className="live-dot size-1.5" />Live · orchestrator connected</span>
    : <span className="flex items-center gap-1.5 text-destructive"><span className="size-1.5 rounded-full bg-destructive" />Orchestrator offline — start it with <code className="font-mono">{START_CMD}</code></span>
}

function OfflineBanner() {
  const { online, loading, error, refresh } = useConsole()
  const [retrying, setRetrying] = useState(false)
  useEffect(() => {
    if (!retrying) return
    const t = setTimeout(() => setRetrying(false), 2500)
    return () => clearTimeout(t)
  }, [retrying])
  if (online || loading) return null
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive sm:px-6 lg:px-8">
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      <span className="font-medium">Orchestrator offline</span>
      <span className="min-w-0 text-destructive/80">
        {error ? `${error}. ` : ''}Start it with <code className="font-mono">{START_CMD}</code>
      </span>
      <button
        type="button"
        onClick={() => { setRetrying(true); refresh() }}
        disabled={retrying}
        className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-destructive/40 bg-card px-2.5 font-medium text-foreground transition hover:border-destructive disabled:opacity-60"
      >
        <RefreshCw className={cn('size-3.5', retrying && 'animate-spin')} aria-hidden /> {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted ? resolvedTheme !== 'light' : true
  return (
    <Tip content={`Switch to ${dark ? 'light' : 'dark'} mode`}>
      <button onClick={() => setTheme(dark ? 'light' : 'dark')} className="flex size-9 items-center justify-center rounded-lg border bg-card text-muted-foreground transition hover:text-foreground" aria-label="Toggle theme">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={dark ? 'moon' : 'sun'} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.18 }}>
            {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </button>
    </Tip>
  )
}

// View-only for visitors on the deployed console; the operator unlocks actions
// with the key (the orchestrator enforces it — this is only the UI side).
function OperatorControl() {
  const { operatorRequired, readOnly, unlock, lock } = useConsole()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  if (!operatorRequired) return null
  if (!readOnly) {
    return (
      <Tip content="Operator mode: actions run against AWS. Click to lock.">
        <button onClick={lock} className="flex h-9 items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-2.5 text-[12px] font-medium text-success transition hover:brightness-110" aria-label="Lock operator mode">
          <LockOpen className="size-3.5" /><span className="hidden md:inline">Operator</span>
        </button>
      </Tip>
    )
  }
  return (
    <div className="relative">
      <Tip content="You're watching live. Actions that change AWS need the operator key.">
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex h-9 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground" aria-label="View only — unlock operator mode">
          <Eye className="size-3.5" /><span className="hidden md:inline">View only</span><Lock className="size-3 text-subtle" />
        </button>
      </Tip>
      {open && (
        <form
          onSubmit={async e => { e.preventDefault(); setBusy(true); const ok = await unlock(key); setBusy(false); if (ok) { setOpen(false); setKey('') } }}
          className="absolute right-0 top-11 z-50 w-72 rounded-xl border bg-popover p-3 shadow-elev-3"
        >
          <label htmlFor="op-key" className="text-xs font-medium">Operator key</label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Unlocks discovery, apply, cutover and reset. Kept in this tab only.</p>
          <div className="mt-2 flex gap-2">
            <input id="op-key" type="password" autoFocus value={key} onChange={e => setKey(e.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border bg-card px-2 text-[13px] outline-none focus:border-primary/50" autoComplete="off" />
            <button disabled={!key || busy} className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">{busy ? '…' : 'Unlock'}</button>
          </div>
        </form>
      )}
    </div>
  )
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname()
  const { openPalette, openCopilot } = useShell()
  const current = NAV.find(n => (n.href === '/' ? pathname === '/' : pathname.startsWith(n.href))) ?? NAV[0]
  return (
    <header className="glass sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 sm:px-6">
      <button onClick={onMenu} className="flex size-9 items-center justify-center rounded-lg border bg-card lg:hidden" aria-label="Open navigation"><Menu className="size-4" /></button>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <Link href="/" className="hidden text-muted-foreground transition hover:text-foreground sm:inline">{current.group}</Link>
        <ChevronRight className="hidden size-3.5 text-subtle sm:inline" />
        <span className="truncate font-medium" aria-current="page">{current.label}</span>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <PipelineRail />
        <OperatorControl />
        <button onClick={openPalette} className="flex h-9 items-center gap-2 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground transition hover:text-foreground sm:w-56" aria-label="Open command palette">
          <Search className="size-4" /><span className="hidden flex-1 text-left sm:inline">Search or run…</span><Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
        </button>
        <Tip content={<>Ask Copilot <Kbd className="ml-1">Ctrl J</Kbd></>}>
          <button onClick={() => openCopilot()} className="glow-brand flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition hover:brightness-110" aria-label="Open AI Copilot">
            <Sparkles className="size-4" /><span className="hidden sm:inline">Copilot</span>
          </button>
        </Tip>
        <ThemeToggle />
      </div>
    </header>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [copilot, setCopilot] = useState<{ open: boolean; prompt?: string; nonce: number }>({ open: false, nonce: 0 })
  const { demoMode, demo, readOnly } = useConsole()

  useEffect(() => { try { setCollapsedState(localStorage.getItem('mac.sidebar') === '1') } catch {} }, [])
  const setCollapsed = (v: boolean) => { setCollapsedState(v); try { localStorage.setItem('mac.sidebar', v ? '1' : '0') } catch {} }

  const openCopilot = useCallback((prompt?: string) => setCopilot(c => ({ open: true, prompt, nonce: c.nonce + 1 })), [])
  const openPalette = useCallback(() => setPaletteOpen(true), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o) }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setCopilot(c => ({ ...c, open: !c.open, prompt: undefined })) }
      else if (e.key === '[' && !typing && !e.metaKey && !e.ctrlKey) setCollapsedState(c => { try { localStorage.setItem('mac.sidebar', c ? '0' : '1') } catch {}; return !c })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <ShellContext.Provider value={{ openPalette, openCopilot }}>
      <a href="#main" className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <div className="flex min-h-dvh">
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />

        <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 lg:hidden" />
            <Dialog.Popup className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r bg-sidebar shadow-elev-3 transition-transform duration-200 data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full lg:hidden">
              <Dialog.Title className="sr-only">Navigation</Dialog.Title>
              <div className="flex h-14 items-center justify-between border-b px-3">
                <Brand collapsed={false} />
                <Dialog.Close className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2" aria-label="Close navigation"><X className="size-4" /></Dialog.Close>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-4"><NavList collapsed={false} onNavigate={() => setMobileOpen(false)} /></div>
              <div className="border-t p-3"><AccountCard /></div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onMenu={() => setMobileOpen(true)} />
          <OfflineBanner />
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
          <footer className="border-t px-4 py-4 text-xs text-subtle sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-1">
              <span>Migration Accelerator</span><span aria-hidden>·</span>
              <ConnectionStatus /><span aria-hidden>·</span>
              <span>{llmLabel(demo?.llm)}</span><span aria-hidden>·</span>
              <span>Mutations allow-listed to <code className="font-mono">managed-by=migration-accelerator</code></span>
              {!demoMode && <span className="ml-auto">Append <code className="font-mono">?demo=1</code> for demo controls</span>}
            </div>
          </footer>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <CopilotPanel open={copilot.open} onOpenChange={open => setCopilot(c => ({ ...c, open }))} initialPrompt={copilot.prompt} nonce={copilot.nonce} />
      {demoMode && !readOnly && <DemoDock />}
    </ShellContext.Provider>
  )
}
