'use client'

// Shared chart chrome so every Recharts chart reads as one system in both themes.

export const axisProps = {
  tick: { fill: 'var(--subtle-foreground)', fontSize: 11 },
  axisLine: false,
  tickLine: false,
} as const

export const gridProps = { stroke: 'var(--chart-grid)', strokeDasharray: '3 3', vertical: false } as const

type Payload = { name?: string; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }

export function ChartTooltip({ active, payload, label, formatter, labelFormatter }: {
  active?: boolean; payload?: Payload[]; label?: string | number
  formatter?: (v: number | string, name: string) => string; labelFormatter?: (l: string | number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs shadow-elev-2">
      {label !== undefined && <div className="mb-1.5 font-medium text-foreground">{labelFormatter ? labelFormatter(label) : label}</div>}
      <div className="flex flex-col gap-1">
        {payload.map(p => (
          <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
            <span className="size-2 rounded-sm" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto pl-3 font-medium tabular text-foreground">{formatter && p.value !== undefined ? formatter(p.value, String(p.name)) : p.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; value?: React.ReactNode }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm" style={{ background: i.color }} />
          {i.label}
          {i.value !== undefined && <span className="font-medium text-foreground tabular">{i.value}</span>}
        </span>
      ))}
    </div>
  )
}
