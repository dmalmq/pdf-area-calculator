import type { Pt } from '../state/types'

export function shoelacePt2(poly: Pt[]): number {
  if (poly.length < 3) return 0

  let sum = 0
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    sum += a.x * b.y - b.x * a.y
  }

  return Math.abs(sum) / 2
}

export function areaToM2(areaPt2: number, mmPerPt: number | null): number | null {
  return mmPerPt == null ? null : (areaPt2 * mmPerPt * mmPerPt) / 1_000_000
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  if (poly.length < 3) return false

  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]
    const b = poly[j]
    const crosses = a.y > p.y !== b.y > p.y
    if (!crosses) continue

    const xAtY = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (p.x < xAtY) inside = !inside
  }

  return inside
}

export function polygonCentroid(poly: Pt[]): Pt {
  if (poly.length === 0) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const p of poly) {
    x += p.x
    y += p.y
  }
  return { x: x / poly.length, y: y / poly.length }
}

export function areaNetPt2(area: { polygon: Pt[]; holes?: Pt[][] }): number {
  const holes = (area.holes ?? []).reduce((sum, ring) => sum + shoelacePt2(ring), 0)
  return Math.max(0, shoelacePt2(area.polygon) - holes)
}

export function pointInArea(area: { polygon: Pt[]; holes?: Pt[][] }, p: Pt): boolean {
  if (!pointInPolygon(p, area.polygon)) return false
  return !(area.holes ?? []).some((ring) => pointInPolygon(p, ring))
}

/** True when a closed polygon ring intersects an axis-aligned rect [min, max]. */
export function polygonIntersectsRect(poly: Pt[], min: Pt, max: Pt): boolean {
  if (poly.length < 3) return false

  for (const v of poly) {
    if (v.x >= min.x && v.x <= max.x && v.y >= min.y && v.y <= max.y) return true
  }

  const corners: Pt[] = [
    { x: min.x, y: min.y },
    { x: max.x, y: min.y },
    { x: max.x, y: max.y },
    { x: min.x, y: max.y }
  ]
  for (const c of corners) {
    if (pointInPolygon(c, poly)) return true
  }

  const rectEdges: Array<[Pt, Pt]> = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]]
  ]

  const orient = (a: Pt, b: Pt, c: Pt): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

  const onSegment = (a: Pt, b: Pt, c: Pt): boolean =>
    Math.min(a.x, b.x) - 1e-9 <= c.x &&
    c.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= c.y &&
    c.y <= Math.max(a.y, b.y) + 1e-9

  const segmentsIntersect = (p1: Pt, q1: Pt, p2: Pt, q2: Pt): boolean => {
    const o1 = orient(p1, q1, p2)
    const o2 = orient(p1, q1, q2)
    const o3 = orient(p2, q2, p1)
    const o4 = orient(p2, q2, q1)

    if (o1 * o2 < 0 && o3 * o4 < 0) return true

    if (Math.abs(o1) <= 1e-9 && onSegment(p1, q1, p2)) return true
    if (Math.abs(o2) <= 1e-9 && onSegment(p1, q1, q2)) return true
    if (Math.abs(o3) <= 1e-9 && onSegment(p2, q2, p1)) return true
    if (Math.abs(o4) <= 1e-9 && onSegment(p2, q2, q1)) return true

    return false
  }

  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    for (const [c, d] of rectEdges) {
      if (segmentsIntersect(a, b, c, d)) return true
    }
  }

  return false
}
