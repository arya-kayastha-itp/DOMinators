'use client'

import { Dialog } from '@base-ui/react/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, ArrowUp, BookOpen, Lightbulb, ShieldAlert, Sparkles, TrendingUp, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SUGGESTED_PROMPTS, answer, type CopilotAnswer } from '@/lib/copilot'
import { fleet } from '@/lib/data/fleet'
import { cn } from '@/lib/utils'
import { useConsole } from '@/components/console/console-provider'
import { Badge } from '@/components/ui/primitives'

type Turn = { id: number; q: string; a: CopilotAnswer }

function Typewriter({ text, onDone }: { text: string; onDone?: () => void }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    setN(0)
    const step = Math.max(2, Math.round(text.length / 60))
    const iv = setInterval(() => setN(v => { if (v + step >= text.length) { clearInterval(iv); onDone?.(); return text.length } return v + step }), 16)
    return () => clearInterval(iv)
  }, [text, onDone])
  return <>{text.slice(0, n)}{n < text.length && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />}</>
}

export function CopilotPanel({ open, onOpenChange, initialPrompt, nonce }: { open: boolean; onOpenChange: (v: boolean) => void; initialPrompt?: string; nonce: number }) {
  const { plan, cutovers, events, statuses } = useConsole()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)

  const ask = (q: string) => {
    if (!q.trim()) return
    setInput('')
    setThinking(true)
    // Short, honest "thinking" beat: the answer is computed, not generated.
    setTimeout(() => {
      setTurns(t => [...t, { id: idRef.current++, q, a: answer(q, { plan, cutovers, events }) }])
      setThinking(false)
    }, 450)
  }

  useEffect(() => { if (open && initialPrompt) ask(initialPrompt) }, [nonce]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [turns, thinking])

  const insights = useMemo(() => {
    const rolled = Object.values(cutovers).find(c => c.run.result === 'ROLLED_BACK')
    const out: { icon: React.ReactNode; tone: string; title: string; body: string; prompt: string }[] = []
    if (rolled) out.push({ icon: <ShieldAlert />, tone: 'text-destructive bg-destructive/10', title: `${rolled.run.app_id} auto-rolled back`, body: rolled.run.rollback?.reason ?? '', prompt: `Why did ${rolled.run.app_id} roll back?` })
    const ssh = fleet.filter(a => a.findings.includes('SG_OPEN_SSH')).length
    out.push({ icon: <Lightbulb />, tone: 'text-warning bg-warning/10', title: `${ssh} apps expose SSH to the internet`, body: 'All are fixed by the golden module (SSM only, no port 22).', prompt: 'Which apps have SSH open to the internet?' })
    out.push({ icon: <TrendingUp />, tone: 'text-success bg-success/10', title: `Finish ${plan.projection.projected_finish}`, body: `${plan.waves.length} waves at ${plan.capacity_per_wave}/wave — ${plan.projection.meets_target_2027 ? 'inside' : 'misses'} the 2027 target.`, prompt: `When do we finish at capacity ${plan.capacity_per_wave}?` })
    if (statuses['app-catalog'] !== 'MIGRATED') out.push({ icon: <BookOpen />, tone: 'text-primary bg-primary/10', title: 'Next best action', body: 'Apply the app-catalog blueprint, then cut over — it has no upstream dependencies.', prompt: 'app-catalog' })
    return out.slice(0, 3)
  }, [cutovers, plan, statuses])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-y-2 right-2 z-50 flex w-[min(440px,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-elev-3 outline-none transition-[transform,opacity] duration-250 data-[ending-style]:translate-x-8 data-[ending-style]:opacity-0 data-[starting-style]:translate-x-8 data-[starting-style]:opacity-0">
          <div className="relative flex items-center gap-3 border-b px-4 py-3">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
            <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-brand-2 text-primary-foreground"><Sparkles className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-sm font-semibold">Migration Copilot</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">Answers are computed from live state and cite their evidence.</Dialog.Description>
            </div>
            <Badge tone="success" className="hidden sm:inline-flex">grounded</Badge>
            <Dialog.Close className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground" aria-label="Close Copilot"><X className="size-4" /></Dialog.Close>
          </div>

          <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {turns.length === 0 && (
              <div>
                <div className="eyebrow">Insights right now</div>
                <div className="mt-2 flex flex-col gap-2">
                  {insights.map(i => (
                    <button key={i.title} onClick={() => ask(i.prompt)} className="group flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition hover:border-border-strong hover:shadow-elev-1">
                      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4', i.tone)}>{i.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium">{i.title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{i.body}</span>
                      </span>
                      <ArrowRight className="mt-1 size-3.5 text-subtle transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </button>
                  ))}
                </div>
                <div className="eyebrow mt-6">Try asking</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SUGGESTED_PROMPTS.map(p => (
                    <button key={p} onClick={() => ask(p)} className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground">{p}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-5">
              {turns.map((t, idx) => (
                <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2">
                  <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] text-primary-foreground">{t.q}</div>
                  <div className="max-w-[95%] rounded-2xl rounded-bl-md border bg-card px-3.5 py-3">
                    <div className="text-[13px] font-semibold">{t.a.title}</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{idx === turns.length - 1 ? <Typewriter text={t.a.text} /> : t.a.text}</p>
                    {t.a.bullets && t.a.bullets.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                        {t.a.bullets.map(b => <li key={b} className="flex gap-2"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />{b}</li>)}
                      </ul>
                    )}
                    {t.a.citations && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {t.a.citations.map(c => <span key={c} className="rounded-md border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-subtle">{c}</span>)}
                      </div>
                    )}
                    {t.a.actions && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {t.a.actions.map(a => (
                          <Link key={a.href + a.label} href={a.href} onClick={() => onOpenChange(false)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition hover:border-primary/40 hover:text-primary">
                            {a.label}<ArrowRight className="size-3" />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
              <AnimatePresence>
                {thinking && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex gap-1">{[0, 1, 2].map(i => <motion.span key={i} className="size-1.5 rounded-full bg-primary" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />)}</span>
                    Querying fleet, plan and events…
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <form onSubmit={e => { e.preventDefault(); ask(input) }} className="border-t p-3">
            <div className="flex items-end gap-2 rounded-xl border bg-card p-1.5 focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/25">
              <label htmlFor="copilot-input" className="sr-only">Ask Copilot</label>
              <textarea
                id="copilot-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) } }}
                rows={1}
                placeholder="Ask about apps, findings, the plan or a rollback…"
                className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[13px] outline-none placeholder:text-subtle"
              />
              <button type="submit" disabled={!input.trim()} className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition disabled:opacity-40" aria-label="Send">
                <ArrowUp className="size-4" />
              </button>
            </div>
            <p className="mt-2 px-1 text-[11px] text-subtle">Rules-grounded answers · Claude on Bedrock rephrases when connected · never decides a rollback.</p>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
