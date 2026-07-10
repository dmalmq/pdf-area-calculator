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
