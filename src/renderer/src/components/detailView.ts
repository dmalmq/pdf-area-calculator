import type { AreaKind, DetailTransform, Pt, Tool } from '../state/types'
import type { BBox } from '../geometry/detailFit'
import { importImagePng, type ImportedImage } from '../utils/importImage'

export { DETAIL_IMAGE_OPACITY } from '../utils/detailPage'
export type ViewportTransform = ReadonlyArray<number>

export function mappedViewportRect(
  bbox: BBox,
  [a, b, c, d, e, f]: ViewportTransform
): { x: number; y: number; w: number; h: number } {
  const corners = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.w, y: bbox.y },
    { x: bbox.x, y: bbox.y + bbox.h },
    { x: bbox.x + bbox.w, y: bbox.y + bbox.h }
  ].map((point) => ({ x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }))
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export function viewportImageMetrics(
  [a, b]: ViewportTransform,
  rotationDegrees: number,
  imageScale: number
): { angleRad: number; scale: number } {
  return {
    angleRad: Math.atan2(b, a) + (rotationDegrees * Math.PI) / 180,
    scale: Math.hypot(a, b) * imageScale
  }
}

export function detailPointerIntent(
  detailEditing: boolean,
  button: number,
  tool: Tool,
  imageHit: boolean,
  summaryHit: boolean
): 'detailSummary' | 'detailImage' | 'pan' | 'normal' | 'none' {
  if (!detailEditing) return button === 1 || (button === 0 && tool === 'pan') ? 'pan' : 'normal'
  if (button === 1) return 'pan'
  if (button === 0 && summaryHit) return 'detailSummary'
  if (button === 0 && imageHit) return 'detailImage'
  if (button === 0 && tool === 'pan') return 'pan'
  return 'none'
}

export function detailKeyboardDelta(key: string, shift: boolean): Pt | null {
  const step = shift ? 10 : 1
  if (key === 'ArrowLeft') return { x: -step, y: 0 }
  if (key === 'ArrowRight') return { x: step, y: 0 }
  if (key === 'ArrowUp') return { x: 0, y: step }
  if (key === 'ArrowDown') return { x: 0, y: -step }
  return null
}

export function summaryPositionAfterDrag(
  startPosition: Pt,
  startPt: Pt,
  currentPt: Pt
): Pt {
  return {
    x: startPosition.x + (currentPt.x - startPt.x),
    y: startPosition.y + (currentPt.y - startPt.y)
  }
}

export interface SummarySourceOffsets {
  dxMin: number
  dxMax: number
  dyMin: number
  dyMax: number
}

/** Signed PDF offsets of a CSS-axis-aligned summary box relative to its top-left anchor. */
export function summarySourceOffsetsFromCss(
  cssW: number,
  cssH: number,
  zoom: number,
  [a, b, c, d]: ViewportTransform
): SummarySourceOffsets {
  if (zoom === 0) return { dxMin: 0, dxMax: 0, dyMin: 0, dyMax: 0 }
  const det = a * d - b * c
  if (det === 0) return { dxMin: 0, dxMax: 0, dyMin: 0, dyMax: 0 }
  const vw = cssW / zoom
  const vh = cssH / zoom
  // Inverse-map the four viewport corners of the CSS box (relative to top-left).
  const corners = [
    { x: 0, y: 0 },
    { x: (d * vw) / det, y: (-b * vw) / det },
    { x: (-c * vh) / det, y: (a * vh) / det },
    { x: (d * vw - c * vh) / det, y: (-b * vw + a * vh) / det }
  ]
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const dxMin = Math.min(...xs)
  const dxMax = Math.max(...xs)
  const dyMin = Math.min(...ys)
  const dyMax = Math.max(...ys)
  // Coerce -0 to +0 so deep equality and JSON stay stable.
  return {
    dxMin: dxMin === 0 ? 0 : dxMin,
    dxMax: dxMax === 0 ? 0 : dxMax,
    dyMin: dyMin === 0 ? 0 : dyMin,
    dyMax: dyMax === 0 ? 0 : dyMax
  }
}


/**
 * Clamp a summary top-left anchor so the CSS box (via signed source offsets) stays
 * inside padded bounds. Unlike clampDetailSummaryPosition, this does not assume -y extent.
 */
export function clampDetailSummaryAnchor(
  position: Pt,
  bounds: BBox,
  offsets: SummarySourceOffsets
): Pt {
  const minX = bounds.x - offsets.dxMin
  const maxX = bounds.x + bounds.w - offsets.dxMax
  const minY = bounds.y - offsets.dyMin
  const maxY = bounds.y + bounds.h - offsets.dyMax
  return {
    // Oversized: pin to the lower bound for x (matches unrotated left pin).
    x: minX > maxX ? minX : Math.min(Math.max(position.x, minX), maxX),
    // Oversized: pin to the upper bound for y (matches unrotated top pin in y-up).
    y: minY > maxY ? maxY : Math.min(Math.max(position.y, minY), maxY)
  }
}

export function shouldUseNativeDetailPaste(
  detailEditing: boolean,
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>
): boolean {
  return (
    detailEditing && (event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')
  )
}

export function shouldDrawDetailTag(kind: AreaKind): boolean {
  return kind === 'store'
}

export function detailFrame(input: {
  rectX: number
  rectY: number
  rectW: number
  rectH: number
  containerW: number
  containerH: number
  margin: number
}): { zoom: number; pan: Pt } {
  const fit = Math.min(input.containerW / input.rectW, input.containerH / input.rectH)
  const zoom = Math.min(Math.max(fit, 0.2), 8)
  return {
    zoom,
    pan: {
      x: input.margin + input.rectX * zoom - (input.containerW - input.rectW * zoom) / 2,
      y: input.margin + input.rectY * zoom - (input.containerH - input.rectH * zoom) / 2
    }
  }
}

export function inverseImagePoint(
  pt: Pt,
  center: Pt,
  scale: number,
  rotationRad: number,
  imgW: number,
  imgH: number
): Pt {
  const dx = pt.x - center.x
  const dy = pt.y - center.y
  const cos = Math.cos(-rotationRad)
  const sin = Math.sin(-rotationRad)
  return {
    x: (dx * cos - dy * sin) / scale + imgW / 2,
    y: (dx * sin + dy * cos) / scale + imgH / 2
  }
}

export function pointInImageRect(local: Pt, imgW: number, imgH: number): boolean {
  return local.x >= 0 && local.x <= imgW && local.y >= 0 && local.y <= imgH
}

export function scaleDetailAboutCursor(
  transform: DetailTransform,
  imgW: number,
  imgH: number,
  cursor: Pt,
  factor: number
): DetailTransform {
  const nextScale = transform.scale * factor
  const cx = transform.x + (imgW * transform.scale) / 2
  const cy = transform.y - (imgH * transform.scale) / 2
  const ratio = nextScale / transform.scale
  const nextCenterX = cursor.x - (cursor.x - cx) * ratio
  const nextCenterY = cursor.y - (cursor.y - cy) * ratio
  return {
    x: nextCenterX - (imgW * nextScale) / 2,
    y: nextCenterY + (imgH * nextScale) / 2,
    scale: nextScale,
    rotation: transform.rotation
  }
}

export async function tryImportDetailImage(
  blob: Blob,
  importer: (blob: Blob) => Promise<ImportedImage> = importImagePng
): Promise<ImportedImage | null> {
  try {
    return await importer(blob)
  } catch {
    return null
  }
}
