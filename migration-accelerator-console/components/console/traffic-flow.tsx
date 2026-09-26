'use client'

// Every particle is one real HTTP request the traffic generator sent through
// the edge ALB (GET /traffic buckets): it travels to the side that actually
// answered (served_by), red if it errored. Lane thickness = live ALB weight.
import { useEffect, useRef } from 'react'
import type { TrafficBucket } from '@/lib/api'

type P = { lane: 'legacy' | 'target' | 'unknown'; err: boolean; born: number; life: number; jitter: number }

const css = (name: string, fallback: string) =>
  typeof window === 'undefined' ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

export function TrafficFlow({ buckets, targetWeight, active, rolledBack }: { buckets: TrafficBucket[]; targetWeight: number; active: boolean; rolledBack: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const particles = useRef<P[]>([])
  const seen = useRef<number>(0)
  const weight = useRef(targetWeight)
  const flash = useRef(0)

  useEffect(() => { weight.current = targetWeight }, [targetWeight])
  useEffect(() => { if (rolledBack) flash.current = performance.now() }, [rolledBack])

  // Spawn one particle per real request in each new per-second bucket, spread over that second.
  useEffect(() => {
    const fresh = buckets.filter(b => b.t > seen.current)
    if (!fresh.length) return
    const first = seen.current === 0
    seen.current = Math.max(...fresh.map(b => b.t))
    if (first) return // don't dump history on mount
    const now = performance.now()
    for (const b of fresh) {
      const reqs: P[] = []
      const push = (lane: P['lane'], n: number, err = false) => { for (let i = 0; i < n; i++) reqs.push({ lane, err, born: 0, life: 1500 + Math.random() * 500, jitter: Math.random() * 2 - 1 }) }
      const errT = Math.min(b.errors, b.target)
      push('target', b.target - errT); push('target', errT, true)
      push('legacy', b.legacy)
      push('unknown', b.unknown, true)
      reqs.forEach((r, i) => { r.born = now + (i / Math.max(1, reqs.length)) * 1000 })
      particles.current.push(...reqs)
    }
    if (particles.current.length > 900) particles.current.splice(0, particles.current.length - 900)
  }, [buckets])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')!
    let raf = 0
    const colors = { legacy: css('--legacy', '#f59e0b'), target: css('--target', '#10b981'), err: css('--destructive', '#ef4444'), line: css('--border-strong', '#444'), muted: css('--muted-foreground', '#888') }

    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1
      const w = el.clientWidth, h = el.clientHeight
      if (el.width !== w * dpr || el.height !== h * dpr) { el.width = w * dpr; el.height = h * dpr }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const src = { x: 70, y: h / 2 }
      const alb = { x: w * 0.36, y: h / 2 }
      const legEnd = { x: w - 90, y: h * 0.24 }
      const tgtEnd = { x: w - 90, y: h * 0.76 }
      const tw = weight.current / 100

      const lane = (end: { x: number; y: number }, color: string, thick: number) => {
        ctx.strokeStyle = color
        ctx.globalAlpha = 0.18 + thick * 0.5
        ctx.lineWidth = 2 + thick * 16
        ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(alb.x, alb.y)
        ctx.bezierCurveTo(alb.x + (end.x - alb.x) * 0.45, alb.y, alb.x + (end.x - alb.x) * 0.55, end.y, end.x, end.y)
        ctx.stroke()
      }
      ctx.globalAlpha = 0.35; ctx.strokeStyle = colors.line; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(alb.x, alb.y); ctx.stroke()
      lane(legEnd, colors.legacy, 1 - tw)
      lane(tgtEnd, colors.target, tw)
      ctx.globalAlpha = 1

      const pos = (p: P, t: number) => {
        const end = p.lane === 'legacy' ? legEnd : p.lane === 'target' ? tgtEnd : { x: alb.x + 40, y: alb.y + 40 }
        if (t < 0.3) { const k = t / 0.3; return { x: src.x + (alb.x - src.x) * k, y: src.y + p.jitter * 3 } }
        const k = (t - 0.3) / 0.7, u = 1 - k
        const c1 = { x: alb.x + (end.x - alb.x) * 0.45, y: alb.y }, c2 = { x: alb.x + (end.x - alb.x) * 0.55, y: end.y }
        return {
          x: u * u * u * alb.x + 3 * u * u * k * c1.x + 3 * u * k * k * c2.x + k * k * k * end.x,
          y: u * u * u * alb.y + 3 * u * u * k * c1.y + 3 * u * k * k * c2.y + k * k * k * end.y + p.jitter * 4,
        }
      }
      const alive: P[] = []
      for (const p of particles.current) {
        const t = (now - p.born) / p.life
        if (t > 1) continue
        alive.push(p)
        if (t < 0) continue
        const { x, y } = pos(p, t)
        const col = p.err ? colors.err : p.lane === 'legacy' ? colors.legacy : colors.target
        ctx.fillStyle = col
        ctx.shadowColor = col
        ctx.shadowBlur = p.err ? 10 : 6
        ctx.globalAlpha = t > 0.9 ? (1 - t) * 10 : 1
        ctx.beginPath(); ctx.arc(x, y, p.err ? 2.6 : 2, 0, Math.PI * 2); ctx.fill()
      }
      particles.current = alive
      ctx.shadowBlur = 0; ctx.globalAlpha = 1

      const since = now - flash.current
      if (flash.current && since < 1400) {
        ctx.fillStyle = colors.err
        ctx.globalAlpha = 0.22 * (1 - since / 1400) * (0.6 + 0.4 * Math.sin(since / 60))
        ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = 1
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="relative h-56 overflow-hidden rounded-xl border bg-surface-2/40 md:h-64">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-40" />
      <canvas ref={canvas} className="absolute inset-0 size-full" aria-label="Live request flow: each dot is one real request through the ALB" role="img" />
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground">traffic<br />generator</div>
      <div className="pointer-events-none absolute left-[36%] top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
        <div className={`flex size-11 items-center justify-center rounded-xl border bg-card font-mono text-[10px] font-semibold shadow-elev-2 ${active ? 'glow-brand border-primary/50' : ''}`}>ALB</div>
        <div className="font-mono text-[10px] text-muted-foreground">{100 - targetWeight}/{targetWeight}</div>
      </div>
      <div className="pointer-events-none absolute right-3 top-[24%] -translate-y-1/2 text-right text-[11px] font-medium text-legacy">Legacy<br /><span className="text-muted-foreground">Account A</span></div>
      <div className="pointer-events-none absolute right-3 top-[76%] -translate-y-1/2 text-right text-[11px] font-medium text-target">Golden target<br /><span className="text-muted-foreground">Account B</span></div>
    </div>
  )
}
