import { detailFit, type BBox } from '../geometry/detailFit'
import { mmPerPtFor, reportByFacilityLevel } from '../state/store'
import type { AppState, Pt } from '../state/types'

export interface DetailSummaryMetrics {
  name: string
  level: string
  areaM2: number | null
  stores: number
}

/** Matches buildReport detail page margin (PDF points). */
export const DETAIL_PAGE_MARGIN = 28
const A4_SHORT = 595.28
const A4_LONG = 841.89

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

/** A4 content box used by detail export for the given facility bbox orientation. */
export function detailPageContentSize(bbox: BBox): { width: number; height: number } {
  const landscape = bbox.w > bbox.h
  const pageW = landscape ? A4_LONG : A4_SHORT
  const pageH = landscape ? A4_SHORT : A4_LONG
  return {
    width: pageW - DETAIL_PAGE_MARGIN * 2,
    height: pageH - DETAIL_PAGE_MARGIN * 2
  }
}

/** Source-space footprint of a summary card: measured output points ÷ detailFit scale. */
export function detailSummarySourceFootprint(
  bbox: BBox,
  outputSize: { w: number; h: number }
): { w: number; h: number } {
  const fit = detailFit(bbox, detailPageContentSize(bbox))
  return { w: outputSize.w / fit.scale, h: outputSize.h / fit.scale }
}

/**
 * Shared editor+export persist clamp: default when unset, then clamp with the
 * measured export footprint so a saved edge position is not re-clamped later.
 * `outputSize` must come from measureDetailSummarySize / renderDetailSummaryPng.
 */
export function resolveDetailSummaryPosition(
  position: Pt | undefined,
  bbox: BBox,
  outputSize: { w: number; h: number }
): Pt {
  return clampDetailSummaryPosition(
    position ?? defaultDetailSummaryPosition(bbox),
    paddedDetailBounds(bbox),
    detailSummarySourceFootprint(bbox, outputSize)
  )
}

export function detailSummaryMetrics(
  state: Pick<AppState, 'areas' | 'pages'>,
  name: string,
  pageIndex: number
): DetailSummaryMetrics | null {
  const page = state.pages.find((candidate) => candidate.pageIndex === pageIndex)
  const level = page?.label
  if (level == null) return null
  // Filter to the requested source page so shared display labels never merge
  // distinct floors when reusing reportByFacilityLevel.
  const row = reportByFacilityLevel({
    ...state,
    areas: state.areas.filter((area) => area.pageIndex === pageIndex)
  }).find((candidate) => candidate.name === name && candidate.level === level)
  if (!row) return null
  // Scale is authoritative: zero-net uncalibrated floors (hole == outer) leave
  // unscaledPt2 at 0 and must still report null, not 0.00 m².
  const calibrated = mmPerPtFor(state, pageIndex) != null
  return {
    name,
    level,
    areaM2: calibrated ? row.areaM2 : null,
    stores: row.stores
  }
}
