import type { BBox } from '../geometry/detailFit'
import { reportByFacilityLevel } from '../state/store'
import type { AppState, Pt } from '../state/types'

export interface DetailSummaryMetrics {
  name: string
  level: string
  areaM2: number | null
  stores: number
}

export function paddedDetailBounds(bbox: BBox): BBox {
  const padX = bbox.w * 0.05
  const padY = bbox.h * 0.05
  return {
    x: bbox.x - padX,
    y: bbox.y - padY,
    w: bbox.w + padX * 2,
    h: bbox.h + padY * 2
  }
}

export function defaultDetailSummaryPosition(bbox: BBox): Pt {
  const bounds = paddedDetailBounds(bbox)
  return { x: bounds.x, y: bounds.y + bounds.h }
}

export function clampDetailSummaryPosition(
  position: Pt,
  bounds: BBox,
  size: { w: number; h: number }
): Pt {
  const maxX = bounds.x + Math.max(0, bounds.w - size.w)
  const minY = bounds.y + Math.min(bounds.h, size.h)
  return {
    x: size.w >= bounds.w ? bounds.x : Math.min(Math.max(position.x, bounds.x), maxX),
    y:
      size.h >= bounds.h
        ? bounds.y + bounds.h
        : Math.min(Math.max(position.y, minY), bounds.y + bounds.h)
  }
}

export function detailSummaryMetrics(
  state: Pick<AppState, 'areas' | 'pages'>,
  name: string,
  pageIndex: number
): DetailSummaryMetrics | null {
  const level = state.pages.find((page) => page.pageIndex === pageIndex)?.label
  if (level == null) return null
  // Filter to the requested source page so shared display labels never merge
  // distinct floors when reusing reportByFacilityLevel.
  const row = reportByFacilityLevel({
    ...state,
    areas: state.areas.filter((area) => area.pageIndex === pageIndex)
  }).find((candidate) => candidate.name === name && candidate.level === level)
  if (!row) return null
  return {
    name,
    level,
    areaM2: row.unscaledPt2 > 0 ? null : row.areaM2,
    stores: row.stores
  }
}
