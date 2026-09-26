'use client'

import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { forwardRef } from 'react'
import type { PipelineStage } from '@/lib/journey/pipeline'

const pad = (n: number) => String(n).padStart(2, '0')

/** Detail card for one stage: name, what it does, input → output. Children marked
 *  data-card-item are staggered in when the card opens. */
export const StageCard = forwardRef<
  HTMLElement,
  {
    stage: PipelineStage
    index: number
    total: number
    /** 'wide' = two columns (horizontal track), 'stack' = one column (mobile / reduced motion). */
    layout?: 'wide' | 'stack'
    onOpen?: () => void
    className?: string
    style?: React.CSSProperties
  }
>(function StageCard({ stage, index, total, layout = 'stack', onOpen, className = '', style }, ref) {
  const wide = layout === 'wide'
  return (
    <article
      ref={ref}
      className={`j-card p-5 md:p-6 ${wide ? 'grid grid-cols-[1.05fr_1fr] gap-x-8' : 'flex flex-col'} ${className}`}
      style={style}
      aria-label={`${stage.name}, stage ${index + 1} of ${total}`}
    >
      <div className="min-w-0">
        <div data-card-item className="flex items-center justify-between gap-4">
          <span className="j-eyebrow">{stage.kicker}</span>
          <span className="j-mono shrink-0 whitespace-nowrap text-[11px] text-[var(--j-faint)]">
            {pad(index + 1)} / {pad(total)}
          </span>
        </div>
        <h3 data-card-item className="mt-3 text-[28px] font-semibold leading-none tracking-[-0.04em] md:text-[34px]">
          {stage.name}
        </h3>
        <p data-card-item className="mt-3 text-[13.5px] leading-relaxed text-[var(--j-muted)]">
          {stage.description}
        </p>
      </div>

      <div className={`flex min-w-0 flex-col ${wide ? '' : 'mt-4'}`}>
      <div data-card-item className="mb-4 grid grid-cols-[1fr_auto_1fr] items-start gap-2">
        <IO label="Input" items={stage.input} />
        <ArrowRight className="mt-6 size-4 text-[var(--j-accent)]" aria-hidden />
        <IO label="Output" items={stage.output} />
      </div>

      <div data-card-item className={`flex items-end justify-between gap-4 border-t border-[var(--j-line)] pt-4 ${wide ? 'mt-auto' : 'mt-5'}`}>
        <div>
          <div className="text-2xl font-semibold leading-none tracking-tight text-[var(--j-accent)]">{stage.metric.value}</div>
          <div className="mt-1 text-xs text-[var(--j-muted)]">{stage.metric.label}</div>
        </div>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            data-cursor="Dive in"
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--j-line-strong)] px-3.5 py-2 text-xs font-medium transition-colors hover:border-[var(--j-accent)] hover:text-[var(--j-accent)]"
          >
            Deep dive <ArrowUpRight className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      </div>
    </article>
  )
})

function IO({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="min-w-0">
      <div className="j-eyebrow mb-2 !text-[10px]">{label}</div>
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <li key={it} className="j-chip w-fit max-w-full !text-[11px] [overflow-wrap:anywhere]">
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}
