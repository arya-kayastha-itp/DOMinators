'use client'

import { motion } from 'framer-motion'
import { ArrowRight, Calculator, Clock, DollarSign, ShieldCheck, Sparkles, Users, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Tier } from '@/lib/contracts'
import { fleet } from '@/lib/data/fleet'
import { buildPlan } from '@/lib/data/planner'
import { cn } from '@/lib/utils'
import { PageHeader, Reveal, StatCard, TIER_COLOR_VAR } from '@/components/console/bits'
import { useConsole } from '@/components/console/console-provider'
import { Card, CardHeader, CountUp } from '@/components/ui/primitives'

function Slider({ id, label, value, min, max, step = 1, onChange, suffix }: { id: string; label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[13px]"><label htmlFor={id} className="text-muted-foreground">{label}</label><span className="font-mono font-medium tabular">{value.toLocaleString()}{suffix}</span></div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[var(--primary)]" />
    </div>
  )
}

export function ImpactView() {
  const { capacity } = useConsole()
  const [manualDays, setManualDays] = useState(9)
  const [rate, setRate] = useState(95)
  const [cap, setCap] = useState(capacity)
  const plan = useMemo(() => buildPlan(cap), [cap])

  const counts = useMemo(() => { const c = { GOLDEN: 0, GRAY: 0, RED: 0 } as Record<Tier, number>; for (const a of fleet) c[a.tier]++; return c }, [])
  const schedulable = counts.GOLDEN + counts.GRAY
  // Manual effort: engineer-days per app. Accelerated: Golden ≈ 0.25 d (review), Gray ≈ 1 d (approval + fixes).
  const manualHours = schedulable * manualDays * 8
  const accelHours = (counts.GOLDEN * 0.25 + counts.GRAY * 1) * 8
  const saved = manualHours - accelHours
  const manualYears = (schedulable * manualDays) / (12 * 220) // 12-engineer team, 220 working days
  const clean = fleet.filter(a => a.findings.length === 0).length
  const before = Math.round((clean / fleet.length) * 100)
  const after = Math.round((schedulable / fleet.length) * 100)

  const lanes = (['GOLDEN', 'GRAY', 'RED'] as Tier[]).map(t => ({
    tier: t, count: counts[t], share: Math.round((counts[t] / fleet.length) * 100),
    note: t === 'GOLDEN' ? 'Flow through untouched — no human in the loop' : t === 'GRAY' ? 'One human approval of the generated diff, then automated' : 'Parked for engineering — replication or licensing first',
  }))

  return (
    <>
      <PageHeader eyebrow="Governance" title="Impact & ROI" description="What the accelerator changes for the program: timeline, effort, and security posture — computed from the same fleet and planner as every other screen." />

      <Card className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-50" />
        <div className="pointer-events-none absolute -left-20 -top-20 size-72 rounded-full bg-success/15 blur-3xl" />
        <div className="relative p-6 md:p-8">
          <div className="eyebrow flex items-center gap-2 text-success"><Zap className="size-3.5" />Program acceleration</div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-3xl font-semibold tracking-tight md:text-5xl">
            <span className="text-subtle line-through decoration-destructive/60 decoration-2">3–4 years</span>
            <ArrowRight className="size-7 text-success md:size-9" />
            <span className="text-gradient">{new Date(`${plan.projection.projected_finish}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>
          </div>
          <p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">Golden apps flow through untouched, Gray apps take one approval, Red apps go to engineers. The pipeline runs unattended for {Math.round((counts.GOLDEN / fleet.length) * 100)}% of the fleet.</p>
        </div>
      </Card>

      <Reveal className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Engineer-hours saved" value={Math.round(saved)} icon={<Clock />} hint={`vs. ${manualDays} engineer-days per app by hand`} trend="up" trendLabel={`${Math.round((saved / manualHours) * 100)}%`} />
        <StatCard label="Labour cost avoided" value={Math.round((saved * rate) / 1000)} prefix="$" suffix="k" icon={<DollarSign />} hint={`at $${rate}/hour blended`} trend="up" trendLabel="modelled" />
        <StatCard label="Manual timeline" value={manualYears} decimals={1} suffix=" yrs" icon={<Users />} hint="12-engineer team, 220 working days/yr" trend="down" trendLabel="replaced" />
        <StatCard label="Apps per working day" value={plan.projection.apps_per_day} decimals={1} icon={<Zap />} hint={`at ${cap} apps per wave`} trend="up" trendLabel="automated" />
      </Reveal>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader icon={<Calculator />} title="ROI calculator" description="Tune the assumptions — every number above updates" />
          <div className="flex flex-col gap-5 p-5 pt-4">
            <Slider id="roi-days" label="Manual effort per app" value={manualDays} min={2} max={25} onChange={setManualDays} suffix=" days" />
            <Slider id="roi-rate" label="Blended hourly rate" value={rate} min={40} max={250} step={5} onChange={setRate} suffix=" $/h" />
            <Slider id="roi-cap" label="Capacity per wave" value={cap} min={4} max={40} onChange={setCap} suffix=" apps" />
            <div className={cn('rounded-xl border p-3 text-[13px]', plan.projection.meets_target_2027 ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5')}>
              Finish <span className="font-semibold">{plan.projection.projected_finish}</span> — {plan.projection.meets_target_2027 ? 'inside' : 'after'} the end-of-2027 target.
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Sparkles />} title="Throughput model" description="Golden flows, Gray approves, Red parks" />
          <ul className="flex flex-col gap-3 p-5 pt-4">
            {lanes.map(l => (
              <li key={l.tier} className="rounded-xl border p-4">
                <div className="flex items-center gap-3">
                  <span className="size-2.5 rounded-full" style={{ background: TIER_COLOR_VAR[l.tier] }} />
                  <span className="text-[13px] font-semibold">{l.tier[0]}{l.tier.slice(1).toLowerCase()}</span>
                  <span className="ml-auto font-mono text-sm tabular">{l.count.toLocaleString()} apps · {l.share}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><motion.div className="h-full rounded-full" style={{ background: TIER_COLOR_VAR[l.tier] }} initial={{ width: 0 }} animate={{ width: `${l.share}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} /></div>
                <p className="mt-2 text-xs text-muted-foreground">{l.note}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader icon={<ShieldCheck />} title="Security posture" description="Share of the fleet on a secure baseline — before and after the program" />
        <div className="grid items-center gap-4 p-5 md:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-5 text-center">
            <div className="eyebrow">Today</div>
            <div className="mt-2 text-5xl font-semibold tracking-tight text-destructive"><CountUp value={before} suffix="%" /></div>
            <div className="mt-1 text-xs text-muted-foreground">apps with zero findings</div>
          </div>
          <ArrowRight className="mx-auto size-6 rotate-90 text-success md:rotate-0" />
          <div className="rounded-xl border border-success/30 bg-success/5 p-5 text-center">
            <div className="eyebrow">After the program</div>
            <div className="mt-2 text-5xl font-semibold tracking-tight text-success"><CountUp value={after} suffix="%" /></div>
            <div className="mt-1 text-xs text-muted-foreground">on golden_app (every non-Red app)</div>
          </div>
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <CardHeader title="What's real vs. simulated" description="Say this plainly to judges" />
        <div className="overflow-x-auto p-2">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-subtle"><th className="px-3 py-2 font-medium">Area</th><th className="px-3 py-2 font-medium">Real</th><th className="px-3 py-2 font-medium">Simulated</th></tr></thead>
            <tbody className="divide-y">
              {[
                ['AWS accounts', 'Two real accounts, peered, cross-account IAM (ap-south-1)', '—'],
                ['Discovery', 'Read-only scan of the 3 live apps in Account A', '1,000 synthetic records, same rules'],
                ['Blueprint', 'terraform apply of golden_app for the 3 live apps', 'Dry-run diffs for the synthetic fleet'],
                ['Cutover', 'ALB weighted target groups + deterministic gates + auto-rollback', 'Synthetic waves use timed events'],
                ['Out of scope', '—', 'Data migration, decommission, licensing, notifications'],
              ].map(([a, r, s]) => (
                <tr key={a}><td className="px-3 py-2.5 font-medium">{a}</td><td className="px-3 py-2.5 text-muted-foreground">{r}</td><td className="px-3 py-2.5 text-muted-foreground">{s}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
