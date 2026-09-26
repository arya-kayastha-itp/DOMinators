// ---------------------------------------------------------------------------
// Geometry for the pipeline path. The path is built from the node positions,
// one cubic Bézier per connection, so node i always sits exactly at the join
// between segment i-1 and segment i. The full path is the segments joined, so
// a node's position along it is the sum of the segment lengths before it.
// ---------------------------------------------------------------------------

export interface Point { x: number; y: number }

/** Cubic between two points. Horizontal = S-curve left→right, vertical = S-curve top→bottom. */
function curve(a: Point, b: Point, axis: 'x' | 'y') {
  if (axis === 'x') {
    const dx = (b.x - a.x) * 0.5
    return `C ${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`
  }
  const dy = (b.y - a.y) * 0.5
  return `C ${a.x} ${a.y + dy} ${b.x} ${b.y - dy} ${b.x} ${b.y}`
}

export function buildPath(points: Point[], axis: 'x' | 'y') {
  if (points.length < 2) return { full: '', segments: [] as string[] }
  const segments = points.slice(1).map((b, i) => `M ${points[i].x} ${points[i].y} ${curve(points[i], b, axis)}`)
  const full = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map((b, i) => curve(points[i], b, axis)).join(' ')
  return { full, segments }
}

/** Horizontal track layout: nodes snake up and down through the upper band of
 *  the pinned frame; the active stage's card opens in the free space below. */
export function horizontalLayout(count: number, width: number, height: number) {
  const spacing = Math.max(width * 0.42, 560)
  const padX = Math.round(width * 0.5)
  const trackWidth = padX * 2 + spacing * (count - 1)
  const center = height * 0.37
  const amp = height * 0.085
  const points = Array.from({ length: count }, (_, i) => ({
    x: padX + spacing * i,
    y: Math.round(center + (i % 2 === 0 ? -amp : amp)),
  }))
  return { points, trackWidth, cardTop: Math.round(center + amp + 72) }
}
