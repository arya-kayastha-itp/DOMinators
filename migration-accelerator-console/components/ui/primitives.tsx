'use client'

import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { cva, type VariantProps } from 'class-variance-authority'
import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------- Card
export function Card({ className, interactive, ...props }: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return <div className={cn('surface', interactive && 'surface-interactive', className)} {...props} />
}
export function CardHeader({ title, description, action, icon, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground [&_svg]:size-4">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />
}

// ---------------------------------------------------------------- Badge
const badgeVariants = cva('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5', {
  variants: {
    tone: {
      neutral: 'border-border bg-surface-2 text-muted-foreground',
      brand: 'border-primary/25 bg-primary/10 text-primary',
      success: 'border-success/25 bg-success/10 text-success',
      warning: 'border-warning/30 bg-warning/10 text-warning',
      danger: 'border-destructive/30 bg-destructive/10 text-destructive',
      info: 'border-info/25 bg-info/10 text-info',
      golden: 'border-golden/25 bg-golden/10 text-golden',
      gray: 'border-gray-tier/30 bg-gray-tier/10 text-gray-tier',
      red: 'border-red-tier/30 bg-red-tier/10 text-red-tier',
      legacy: 'border-legacy/30 bg-legacy/10 text-legacy',
      target: 'border-target/30 bg-target/10 text-target',
    },
  },
  defaultVariants: { tone: 'neutral' },
})
export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

// ---------------------------------------------------------------- Skeleton
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-4 w-full', className)} />
}

// ---------------------------------------------------------------- Kbd
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 font-mono text-[10px] font-medium text-muted-foreground', className)}>{children}</kbd>
}

// ---------------------------------------------------------------- Tooltip
export function Tip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactElement; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={8} className="z-[100]">
          <BaseTooltip.Popup className="max-w-72 rounded-lg border bg-popover px-2.5 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-elev-2 transition-[opacity,transform] data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}

// ---------------------------------------------------------------- Input
export function Input({ className, icon, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode }) {
  return (
    <div className={cn('relative flex items-center', className)}>
      {icon && <span className="pointer-events-none absolute left-3 text-subtle [&_svg]:size-4">{icon}</span>}
      <input
        className={cn('h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none transition placeholder:text-subtle focus:border-primary/50 focus:ring-3 focus:ring-ring/30', icon && 'pl-9')}
        {...props}
      />
    </div>
  )
}

// ---------------------------------------------------------------- Segmented control
export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; label: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex rounded-lg border bg-surface-2 p-0.5">
      {options.map(o => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn('relative z-10 rounded-md font-medium transition-colors', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]', active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {active && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 -z-10 rounded-md border bg-card shadow-elev-1" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- Progress
export function Progress({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'success' | 'danger' | 'target' }) {
  const color = { brand: 'bg-primary', success: 'bg-success', danger: 'bg-destructive', target: 'bg-target' }[tone]
  return (
    <div role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <motion.div className={cn('h-full rounded-full', color)} initial={false} animate={{ width: `${Math.max(0, Math.min(100, value))}%` }} transition={{ duration: 0.4, ease: 'easeOut' }} />
    </div>
  )
}

// ---------------------------------------------------------------- Animated counter
export function CountUp({ value, decimals = 0, duration = 700, prefix = '', suffix = '' }: { value: number; decimals?: number; duration?: number; prefix?: string; suffix?: string }) {
  const [n, setN] = useState(value)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setN(a + (value - a) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <span className="tabular">{prefix}{n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>
}

// ---------------------------------------------------------------- Empty state
export function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border bg-surface-2 text-muted-foreground [&_svg]:size-5">{icon}</div>
      <h4 className="mt-4 text-sm font-semibold">{title}</h4>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
