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
