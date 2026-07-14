import type { Pt } from '../state/types'

export interface Segment {
  a: Pt
  b: Pt
}

export type SnapKind = 'endpoint' | 'intersection' | 'line'

export interface SnapHit {
  pt: Pt
  kind: SnapKind
  dist: number
}

export interface SnapTargets {
  endpoints: boolean
  intersections: boolean
  lines: boolean
}

const DEFAULT_CELL_SIZE = 32
const INTERSECTION_POOL_CAP = 64
const EPS = 1e-9

/** Uniform grid spatial hash over segments. */
export class SegmentIndex {
  private readonly cellSize: number
  private readonly cells = new Map<string, Segment[]>()

  constructor(segments: Segment[], cellSize: number = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize > 0 ? cellSize : DEFAULT_CELL_SIZE

    for (const s of segments) {
      const minX = Math.min(s.a.x, s.b.x)
      const maxX = Math.max(s.a.x, s.b.x)
      const minY = Math.min(s.a.y, s.b.y)
      const maxY = Math.max(s.a.y, s.b.y)

      const cMinX = Math.floor(minX / this.cellSize)
      const cMaxX = Math.floor(maxX / this.cellSize)
      const cMinY = Math.floor(minY / this.cellSize)
      const cMaxY = Math.floor(maxY / this.cellSize)

      for (let cx = cMinX; cx <= cMaxX; cx += 1) {
        for (let cy = cMinY; cy <= cMaxY; cy += 1) {
          const key = `${cx},${cy}`
          let bucket = this.cells.get(key)
          if (!bucket) {
            bucket = []
            this.cells.set(key, bucket)
          }
          bucket.push(s)
        }
      }
    }
  }

  /** Segments whose grid cells intersect the axis-aligned square around `pt`. Deduplicated. */
  near(pt: Pt, radius: number): Segment[] {
    if (radius < 0) return []

    const cMinX = Math.floor((pt.x - radius) / this.cellSize)
    const cMaxX = Math.floor((pt.x + radius) / this.cellSize)
    const cMinY = Math.floor((pt.y - radius) / this.cellSize)
    const cMaxY = Math.floor((pt.y + radius) / this.cellSize)

    const seen = new Set<Segment>()
    const out: Segment[] = []

    for (let cx = cMinX; cx <= cMaxX; cx += 1) {
      for (let cy = cMinY; cy <= cMaxY; cy += 1) {
        const bucket = this.cells.get(`${cx},${cy}`)
        if (!bucket) continue
        for (const s of bucket) {
          if (seen.has(s)) continue
          seen.add(s)
          out.push(s)
        }
      }
    }

    return out
  }
}

/** Closest point on the closed segment `s` to point `p`. */
export function nearestOnSegment(p: Pt, s: Segment): Pt {
  const dx = s.b.x - s.a.x
  const dy = s.b.y - s.a.y
  const len2 = dx * dx + dy * dy
  if (len2 <= EPS) return { x: s.a.x, y: s.a.y }

  let t = ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1

  return { x: s.a.x + t * dx, y: s.a.y + t * dy }
}

/**
 * Intersection of two closed segments, or null if parallel/disjoint.
 * Parameter range is [0, 1] on both, with a small epsilon.
 */
export function segmentIntersection(s1: Segment, s2: Segment): Pt | null {
  const x1 = s1.a.x
  const y1 = s1.a.y
  const x2 = s1.b.x
  const y2 = s1.b.y
  const x3 = s2.a.x
  const y3 = s2.a.y
  const x4 = s2.b.x
  const y4 = s2.b.y

  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(den) <= EPS) return null

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den

  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null

  const tt = Math.min(1, Math.max(0, t))
  return { x: x1 + tt * (x2 - x1), y: y1 + tt * (y2 - y1) }
}

/**
 * Resolve the nearest snap hit by tier priority:
 * endpoint → intersection → line. First enabled tier with a hit wins.
 */
export function resolveSnap(input: {
  pt: Pt
  tolerance: number
  targets: SnapTargets
  index: SegmentIndex | null
  extraSegments?: Segment[]
  extraPoints?: Pt[]
}): SnapHit | null {
  const { pt, tolerance, targets } = input
  if (tolerance < 0) return null

  const fromIndex = input.index?.near(pt, tolerance) ?? []
  const extras = input.extraSegments ?? []
  const seenSeg = new Set<Segment>()
  const candidates: Segment[] = []
  for (const s of fromIndex) {
    if (seenSeg.has(s)) continue
    seenSeg.add(s)
    candidates.push(s)
  }
  for (const s of extras) {
    if (seenSeg.has(s)) continue
    seenSeg.add(s)
    candidates.push(s)
  }

  if (targets.endpoints) {
    const points: Pt[] = []
    for (const s of candidates) {
      points.push(s.a, s.b)
    }
    if (input.extraPoints) points.push(...input.extraPoints)

    let best: SnapHit | null = null
    for (const c of points) {
      const d = Math.hypot(c.x - pt.x, c.y - pt.y)
      if (d > tolerance) continue
      if (!best || d < best.dist) best = { pt: c, kind: 'endpoint', dist: d }
    }
    if (best) return best
  }

  if (targets.intersections && candidates.length >= 2) {
    // Cap the pool at nearest segments to bound O(n²).
    let pool = candidates
    if (pool.length > INTERSECTION_POOL_CAP) {
      pool = [...pool]
        .sort((a, b) => {
          const na = nearestOnSegment(pt, a)
          const nb = nearestOnSegment(pt, b)
          const da = (na.x - pt.x) ** 2 + (na.y - pt.y) ** 2
          const db = (nb.x - pt.x) ** 2 + (nb.y - pt.y) ** 2
          return da - db
        })
        .slice(0, INTERSECTION_POOL_CAP)
    }

    let best: SnapHit | null = null
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        const hit = segmentIntersection(pool[i], pool[j])
        if (!hit) continue
        const d = Math.hypot(hit.x - pt.x, hit.y - pt.y)
        if (d > tolerance) continue
        if (!best || d < best.dist) best = { pt: hit, kind: 'intersection', dist: d }
      }
    }
    if (best) return best
  }

  if (targets.lines) {
    let best: SnapHit | null = null
    for (const s of candidates) {
      const c = nearestOnSegment(pt, s)
      const d = Math.hypot(c.x - pt.x, c.y - pt.y)
      if (d > tolerance) continue
      if (!best || d < best.dist) best = { pt: c, kind: 'line', dist: d }
    }
    if (best) return best
  }

  return null
}
