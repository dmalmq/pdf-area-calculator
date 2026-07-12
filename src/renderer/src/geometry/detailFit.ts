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
// Raw IEEE-754 arithmetic; callers rely on a 6-decimal tolerance.
export function detailFit(
  bbox: BBox,
  avail: { width: number; height: number }
): { scale: number; offsetX: number; offsetY: number } {
  const paddedW = bbox.w * 1.1
  const paddedH = bbox.h * 1.1
  // A zero padded dimension has no scale of its own; fit on the other, or
  // fall back to 1 when the bbox is a point, so the result stays finite and
  // the content lands at the center of `avail`.
  const scaleX = paddedW > 0 ? avail.width / paddedW : Infinity
  const scaleY = paddedH > 0 ? avail.height / paddedH : Infinity
  let scale = Math.min(scaleX, scaleY)
  if (!Number.isFinite(scale)) scale = 1
  const offsetX = (avail.width - paddedW * scale) / 2
  const offsetY = (avail.height - paddedH * scale) / 2
  return { scale, offsetX, offsetY }
}
