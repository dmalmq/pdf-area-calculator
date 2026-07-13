import type { AreaKind, Tool } from '../state/types'
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
  imageHit: boolean
): 'detailImage' | 'pan' | 'normal' | 'none' {
  if (!detailEditing) return button === 1 || (button === 0 && tool === 'pan') ? 'pan' : 'normal'
  if (button === 1) return 'pan'
  if (button === 0 && imageHit) return 'detailImage'
  if (button === 0 && tool === 'pan') return 'pan'
  return 'none'
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
