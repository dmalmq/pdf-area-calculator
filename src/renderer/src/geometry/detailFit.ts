import type { Area } from '../state/types'

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

// Union bbox of every facility+store polygon (outer rings) for a (name, page)
// combo, in PDF points; null when no polygon matches. Holes never grow the bbox.
export function facilityDetailBBox(areas: Area[], name: string, pageIndex: number): BBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false
  for (const area of areas) {
    if (area.name !== name || area.pageIndex !== pageIndex) continue
    for (const pt of area.polygon) {
      found = true
      if (pt.x < minX) minX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.x > maxX) maxX = pt.x
      if (pt.y > maxY) maxY = pt.y
    }
  }
  if (!found) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// Pad the bbox 5% per side, fit it uniformly into `avail`, and center it.
// Offsets are avail-local (origin bottom-left, y up). A point maps as
// tx = (p.x - (bbox.x - 0.05*bbox.w)) * scale + offsetX (y likewise).
// Results are snapped to 1e-9 to shed IEEE-754 noise (e.g. 100*1.1), so that
// exact-fit cases land on clean integers; this is ~500x tighter than the
// 6-decimal tolerance callers rely on, so it never distorts real geometry.
const snap = (n: number): number => {
  const r = Math.round(n * 1e9) / 1e9
  return r === 0 ? 0 : r // collapse -0 → 0 (Object.is distinguishes them)
}

export function detailFit(
  bbox: BBox,
  avail: { width: number; height: number }
): { scale: number; offsetX: number; offsetY: number } {
  const paddedW = bbox.w * 1.1
  const paddedH = bbox.h * 1.1
  const scale = snap(Math.min(avail.width / paddedW, avail.height / paddedH))
  const offsetX = snap((avail.width - paddedW * scale) / 2)
  const offsetY = snap((avail.height - paddedH * scale) / 2)
  return { scale, offsetX, offsetY }
}
