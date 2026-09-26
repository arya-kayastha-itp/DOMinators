'use client'

import { Dialog } from '@base-ui/react/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, ArrowUp, Layers3, ShieldAlert, Sparkles, TrendingUp, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, type CopilotAnswer } from '@/lib/api'
import { FINDING_META } from '@/lib/meta'
import { cn } from '@/lib/utils'
import { useConsole } from '@/components/console/console-provider'
import { Badge } from '@/components/ui/primitives'
import { llmLabel } from './app-shell'

type Turn = { id: number; q: string; a: CopilotAnswer | null; error?: string }

const SUGGESTED_PROMPTS = [
  'Which apps are parked and why?',
  'When does the plan finish and does it meet 2027?',
  'What happened in the last cutover of app-orders?',
  'Summarise fleet risk by tier',
]

function Typewriter({ text }: { text: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    setN(0)
    const step = Math.max(2, Math.round(text.length / 60))
    const iv = setInterval(() => setN(v => { if (v + step >= text.length) { clearInterval(iv); return text.length } return v + step }), 16)
    return () => clearInterval(iv)
  }, [text])
  return <>{text.slice(0, n)}{n < text.length && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />}</>
}

export function CopilotPanel({ open, onOpenChange, initialPrompt, nonce }: { open: boolean; onOpenChange: (v: boolean) => void; initialPrompt?: string; nonce: number }) {
  const { online, summary, plan, cutovers, demo } = useConsole()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || thinking) return
    setInput('')
    setThinking(true)
    const id = idRef.current++
    try {
      const a = await api.copilot(question)
      setTurns(t => [...t, { id, q: question, a }])
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err)
      setTurns(t => [...t, { id, q: question, a: null, error: msg }])
    } finally {
      setThinking(false)
    }
  }

  useEffect(() => { if (open && initialPrompt) ask(initialPrompt) }, [nonce]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [turns, thinking])

  // Insight cards: every number here is read from the live summary / plan / cutovers.
  const insights = useMemo(() => {
    const out: { icon: React.ReactNode; tone: string; title: string; body: string; prompt: string }[] = []
    const rolled = Object.values(cutovers).find(r => r.result === 'ROLLED_BACK')
    if (rolled) {
      out.push({
        icon: <ShieldAlert />, tone: 'text-destructive bg-destructive/10',
        title: `${rolled.app_id} auto-rolled back${rolled.rollback ? ` at ${rolled.rollback.at_weight}% target` : ''}`,
        body: rolled.rollback?.reason ?? rolled.explanation,
        prompt: `What happened in the last cutover of ${rolled.app_id}?`,
      })
    }
    if (plan) {
      const p = plan.projection
      out.push({
        icon: <TrendingUp />, tone: p.meets_target_2027 ? 'text-success bg-success/10' : 'text-destructive bg-destructive/10',
        title: `Projected finish ${p.projected_finish}`,
        body: `${plan.waves.length} waves at ${plan.capacity_per_wave}/wave · ${plan.parked.length} parked — ${p.meets_target_2027 ? 'meets' : 'misses'} the 2027 target.`,
        prompt: 'When does the plan finish and does it meet 2027?',
      })
    }
    if (summary?.discovered) {
      const t = summary.tiers
      out.push({
        icon: <Layers3 />, tone: 'text-primary bg-primary/10',
        title: `${summary.apps_total.toLocaleString()} apps: ${t.GOLDEN} golden · ${t.GRAY} gray · ${t.RED} red`,
        body: `${summary.real} live in Account A, ${summary.synthetic.toLocaleString()} synthetic.`,
        prompt: 'Summarise fleet risk by tier',
      })
      const ssh = summary.findings.SG_OPEN_SSH ?? 0
      if (ssh > 0) {
        out.push({
          icon: <AlertTriangle />, tone: 'text-warning bg-warning/10',
          title: `SG_OPEN_SSH flagged on ${ssh.toLocaleString()} apps`,
          body: `Golden module fix: ${FINDING_META.SG_OPEN_SSH.fix}.`,
          prompt: 'Which apps have SSH open to the internet?',
        })
      }
    }
    return out.slice(0, 3)
  }, [cutovers, plan, summary])

  const llm = demo?.llm
  const llmOff = !llm || !llm.backend || llm.backend === 'off'

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
              <Dialog.Description className="text-xs text-muted-foreground">Answers come from live orchestrator facts and show their evidence.</Dialog.Description>
            </div>
            <Badge tone={online ? 'success' : 'danger'} className="hidden sm:inline-flex">{online ? 'grounded' : 'offline'}</Badge>
            <Dialog.Close className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground" aria-label="Close Copilot"><X className="size-4" /></Dialog.Close>
          </div>

          <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4" aria-live="polite" aria-busy={thinking}>
            {turns.length === 0 && (
              <div>
                <div className="eyebrow">Insights right now</div>
                {insights.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-2">
                    {insights.map(i => (
                      <button key={i.title} onClick={() => ask(i.prompt)} disabled={thinking || !online} className="group flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition hover:border-border-strong hover:shadow-elev-1 disabled:opacity-60">
                        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4', i.tone)}>{i.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium">{i.title}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{i.body}</span>
                        </span>
                        <ArrowRight className="mt-1 size-3.5 text-subtle transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 rounded-xl border border-dashed bg-card p-3 text-xs text-muted-foreground">
                    {online ? 'No live data yet — run discovery to populate the fleet, then build a wave plan.' : 'The orchestrator is offline, so there are no live facts to show.'}
                  </p>
                )}
                <div className="eyebrow mt-6">Try asking</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SUGGESTED_PROMPTS.map(p => (
                    <button key={p} onClick={() => ask(p)} disabled={thinking || !online} className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60">{p}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-5">
              {turns.map((t, idx) => (
                <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2">
                  <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] text-primary-foreground">{t.q}</div>
                  {t.a ? (
                    <div className="max-w-[95%] rounded-2xl rounded-bl-md border bg-card px-3.5 py-3">
                      <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">{idx === turns.length - 1 ? <Typewriter text={t.a.answer} /> : t.a.answer}</p>
                      {t.a.facts.length > 0 && (
                        <details className="group mt-3">
                          <summary className="cursor-pointer select-none text-[11px] font-medium text-subtle transition hover:text-foreground">
                            Evidence · {t.a.facts.length} live fact{t.a.facts.length === 1 ? '' : 's'}
                          </summary>
                          <ul className="mt-1.5 flex flex-col gap-1">
                            {t.a.facts.map((f, i) => (
                              <li key={i} className="rounded-md border bg-surface-2 px-2 py-1 font-mono text-[10.5px] leading-snug text-muted-foreground">{f}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <div className={cn('mt-2.5 flex items-center gap-1.5 border-t pt-2 text-[10.5px]', t.a.fallback ? 'text-warning' : 'text-subtle')}>
                        {t.a.fallback
                          ? <><AlertTriangle className="size-3" aria-hidden /> LLM unavailable — facts only</>
                          : <><Sparkles className="size-3" aria-hidden /> Answered by {t.a.model ?? llm?.model ?? 'the LLM'} from live facts</>}
                      </div>
                    </div>
                  ) : (
                    <div role="alert" className="max-w-[95%] rounded-2xl rounded-bl-md border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-[13px] text-destructive">
                      Copilot request failed: {t.error}
                    </div>
                  )}
                </motion.div>
              ))}
              <AnimatePresence>
                {thinking && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                    <span className="flex gap-1">{[0, 1, 2].map(i => <motion.span key={i} className="size-1.5 rounded-full bg-primary" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />)}</span>
                    {llmOff ? 'Gathering live facts…' : `Gathering live facts and asking ${llm?.model ?? llm?.backend}…`}
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
                placeholder={online ? 'Ask about apps, findings, the plan or a rollback…' : 'Orchestrator offline'}
                className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[13px] outline-none placeholder:text-subtle"
              />
              <button type="submit" disabled={!input.trim() || thinking || !online} className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition disabled:opacity-40" aria-label="Send">
                <ArrowUp className="size-4" />
              </button>
            </div>
            <p className="mt-2 px-1 text-[11px] text-subtle">{llmLabel(llm)} · grounded in live store facts · never decides a rollback.</p>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
