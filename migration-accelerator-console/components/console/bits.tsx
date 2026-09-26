'use client'

import { motion } from 'framer-motion'
import { Activity, ArrowDownRight, ArrowUpRight, Boxes, GitBranch, Info, LayoutDashboard, Layers3, Rocket, ShieldCheck, Terminal, TrendingUp } from 'lucide-react'
import type { AppStatus, FindingCode, Source, Tier } from '@/lib/contracts'
import { FINDING_META } from '@/lib/data/fleet'
import { cn } from '@/lib/utils'
import { Badge, Card, CountUp, Tip } from '@/components/ui/primitives'

// ---------------------------------------------------------------- Navigation model
export const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, group: 'Program', description: 'Mission control for the migration program' },
  { href: '/fleet', label: 'Fleet', icon: Boxes, group: 'Discover', description: 'Every discovered app, finding and tier' },
  { href: '/dependencies', label: 'Dependencies', icon: GitBranch, group: 'Discover', description: '3D dependency topology' },
  { href: '/plan', label: 'Wave plan', icon: Layers3, group: 'Plan', description: 'Dependency-ordered waves and the 2027 projection' },
  { href: '/blueprint', label: 'Blueprint', icon: ShieldCheck, group: 'Execute', description: 'Legacy → hardened Terraform diff' },
  { href: '/cutover', label: 'Cutover', icon: Rocket, group: 'Execute', description: 'Live traffic shift with auto-rollback' },
  { href: '/activity', label: 'Activity', icon: Terminal, group: 'Govern', description: 'Audit trail of every agent decision' },
  { href: '/impact', label: 'Impact', icon: TrendingUp, group: 'Govern', description: 'ROI and security posture' },
] as const

// ---------------------------------------------------------------- Page header
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- Badges
export const TIER_TONE = { GOLDEN: 'golden', GRAY: 'gray', RED: 'red' } as const
export const TIER_COLOR_VAR: Record<Tier, string> = { GOLDEN: 'var(--golden)', GRAY: 'var(--gray-tier)', RED: 'var(--red-tier)' }
export const TIER_LABEL: Record<Tier, string> = { GOLDEN: 'Golden', GRAY: 'Gray', RED: 'Red' }

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <Badge tone={TIER_TONE[tier]} className={className}>
      <span className="size-1.5 rounded-full" style={{ background: TIER_COLOR_VAR[tier] }} />
      {TIER_LABEL[tier]}
    </Badge>
  )
}

export function SourceBadge({ source }: { source: Source }) {
  return source === 'real'
    ? <Tip content="Running in the live legacy AWS account (Account A)"><span><Badge tone="brand" className="font-mono text-[10px] uppercase tracking-wider"><span className="live-dot size-1.5 text-primary" /> Live</Badge></span></Tip>
    : <Badge tone="neutral" className="font-mono text-[10px] uppercase tracking-wider">Synthetic</Badge>
}

const STATUS_TONE: Record<AppStatus, React.ComponentProps<typeof Badge>['tone']> = {
  DISCOVERED: 'neutral', TIERED: 'neutral', PLANNED: 'info', PARKED: 'red', BLUEPRINTED: 'brand', PROVISIONED: 'target', FAILED: 'danger', CUTTING_OVER: 'warning', MIGRATED: 'success', ROLLED_BACK: 'danger',
}
export function StatusBadge({ status }: { status: AppStatus }) {
  return <Badge tone={STATUS_TONE[status]} className="font-mono text-[10px] tracking-wide">{status.replace('_', ' ')}</Badge>
}

export function FindingChip({ code, withFix }: { code: FindingCode; withFix?: boolean }) {
  const m = FINDING_META[code]
  const tone = m.severity === 'critical' ? 'danger' : m.severity === 'high' ? 'warning' : 'neutral'
  return (
    <Tip content={<><div className="font-medium">{m.label}</div><div className="mt-0.5 text-muted-foreground">Fix: {m.fix}</div></>}>
      <span className="inline-flex">
        <Badge tone={tone} className="cursor-default font-mono text-[10px]">{code}{withFix && <span className="font-sans text-muted-foreground">→ fixed</span>}</Badge>
      </span>
    </Tip>
  )
}

export function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Tip content={children}>
      <button type="button" aria-label="More information" className="inline-flex text-subtle transition hover:text-foreground"><Info className="size-3.5" /></button>
    </Tip>
  )
}

// ---------------------------------------------------------------- Sparkline (tiny, dependency-free)
export function Sparkline({ data, color = 'var(--primary)', className }: { data: number[]; color?: string; className?: string }) {
  const w = 120, h = 36
  const max = Math.max(...data), min = Math.min(...data)
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / (max - min || 1)) * (h - 4) - 2])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const id = `spark-${color.replace(/[^a-z]/gi, '')}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('h-9 w-full', className)} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <motion.path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
    </svg>
  )
}

// ---------------------------------------------------------------- KPI card
export function StatCard({ label, value, decimals, suffix, prefix, hint, trend, trendLabel, spark, color, icon, tip }: {
  label: string; value: number | string; decimals?: number; suffix?: string; prefix?: string; hint?: React.ReactNode
  trend?: 'up' | 'down' | 'flat'; trendLabel?: string; spark?: number[]; color?: string; icon?: React.ReactNode; tip?: React.ReactNode
}) {
  const positive = trend === 'up'
  return (
    <motion.div variants={fadeUp}>
      <Card interactive className="relative h-full overflow-hidden p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
            {icon && <span className="text-subtle [&_svg]:size-4">{icon}</span>}
            {label}
            {tip && <InfoTip>{tip}</InfoTip>}
          </div>
          {trendLabel && (
            <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium', positive ? 'bg-success/10 text-success' : trend === 'down' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
              {trend === 'up' ? <ArrowUpRight className="size-3" /> : trend === 'down' ? <ArrowDownRight className="size-3" /> : <Activity className="size-3" />}
              {trendLabel}
            </span>
          )}
        </div>
        <div className="mt-3 text-[28px] font-semibold leading-none tracking-tight">
          {typeof value === 'number' ? <CountUp value={value} decimals={decimals} suffix={suffix} prefix={prefix} /> : value}
        </div>
        {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
        {spark && <Sparkline data={spark} color={color} className="mt-3 -mb-1" />}
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------- Motion presets
export const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } } }
export const fadeUp = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } } }

export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  return <motion.div initial="hidden" animate="show" variants={stagger} className={className}>{children}</motion.div>
}
export function RevealItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return <motion.div variants={fadeUp} className={className}>{children}</motion.div>
}
