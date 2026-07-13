import { describe, expect, it } from 'vitest'

import {
  clampDetailSummaryPosition,
  defaultDetailSummaryPosition,
  detailSummaryMetrics,
  paddedDetailBounds
} from './detailSummary'

const bbox = { x: 100, y: 200, w: 400, h: 200 }

const pages = [
  { pageIndex: 7, label: 'B1F', scale: { kind: 'custom' as const, mmPerPt: 1000 } },
  { pageIndex: 8, label: '2F', scale: null }
]

const square = (pageIndex: number, kind: 'facility' | 'store') => ({
  id: `${kind}-${pageIndex}`,
  pageIndex,
  kind,
  name: 'Central Mall',
  polygon: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ]
})

describe('detail summary geometry', () => {
  it('pads detail bounds by five percent per side', () => {
    expect(paddedDetailBounds(bbox)).toEqual({ x: 80, y: 190, w: 440, h: 220 })
  })

  it('defaults the top-left anchor to the padded bounds top-left', () => {
    expect(defaultDetailSummaryPosition(bbox)).toEqual({ x: 80, y: 410 })
  })

  it('keeps the entire summary inside the padded bounds', () => {
    const bounds = paddedDetailBounds(bbox)
    expect(clampDetailSummaryPosition({ x: 999, y: -999 }, bounds, { w: 120, h: 60 })).toEqual({
      x: 400,
      y: 250
    })
  })

  it('pins to the leading edge when the summary is larger than an axis', () => {
    const bounds = paddedDetailBounds(bbox)
    expect(clampDetailSummaryPosition({ x: 300, y: 300 }, bounds, { w: 900, h: 900 })).toEqual({
      x: 80,
      y: 410
    })
  })
})

describe('detailSummaryMetrics', () => {
  it('returns current facility-floor area and store count', () => {
    const state = {
      pages,
      areas: [square(7, 'facility'), square(7, 'store')]
    }
    expect(detailSummaryMetrics(state, 'Central Mall', 7)).toEqual({
      name: 'Central Mall',
      level: 'B1F',
      areaM2: 100,
      stores: 1
    })
  })

  it('returns null area for an uncalibrated floor', () => {
    const state = { pages, areas: [square(8, 'facility')] }
    expect(detailSummaryMetrics(state, 'Central Mall', 8)).toEqual({
      name: 'Central Mall',
      level: '2F',
      areaM2: null,
      stores: 0
    })
  })

  it('scopes area and stores to the requested page when labels collide', () => {
    const sharedLabelPages = [
      { pageIndex: 0, label: '1F', scale: { kind: 'custom' as const, mmPerPt: 1000 } },
      { pageIndex: 1, label: '1F', scale: { kind: 'custom' as const, mmPerPt: 1000 } }
    ]
    const large = {
      id: 'facility-0',
      pageIndex: 0,
      kind: 'facility' as const,
      name: 'Central Mall',
      polygon: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 }
      ]
    }
    const small = {
      id: 'facility-1',
      pageIndex: 1,
      kind: 'facility' as const,
      name: 'Central Mall',
      polygon: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 }
      ]
    }
    const storeOnLarge = {
      id: 'store-0',
      pageIndex: 0,
      kind: 'store' as const,
      name: 'Central Mall',
      polygon: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 }
      ]
    }
    const state = {
      pages: sharedLabelPages,
      areas: [large, small, storeOnLarge]
    }
    expect(detailSummaryMetrics(state, 'Central Mall', 0)).toEqual({
      name: 'Central Mall',
      level: '1F',
      areaM2: 200,
      stores: 1
    })
    expect(detailSummaryMetrics(state, 'Central Mall', 1)).toEqual({
      name: 'Central Mall',
      level: '1F',
      areaM2: 100,
      stores: 0
    })
  })
})
