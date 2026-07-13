import { describe, expect, it, vi } from 'vitest'

import {
  DETAIL_IMAGE_OPACITY,
  clampDetailSummaryAnchor,
  detailKeyboardDelta,
  detailPointerIntent,
  mappedViewportRect,
  shouldDrawDetailTag,
  shouldUseNativeDetailPaste,
  summaryPositionAfterDrag,
  summarySourceOffsetsFromCss,
  summarySourceSizeFromCss,
  tryImportDetailImage,
  viewportImageMetrics
} from './detailView'

describe('detail viewport transforms', () => {
  const bbox = { x: 10, y: 20, w: 100, h: 40 }

  it.each([
    [[0, 2, 2, 0, 0, 0], { x: 40, y: 20, w: 80, h: 200 }],
    [[-2, 0, 0, 2, 300, 0], { x: 80, y: 40, w: 200, h: 80 }],
    [[0, -2, -2, 0, 300, 400], { x: 180, y: 180, w: 80, h: 200 }]
  ] as const)('maps all four bbox corners for a rotated viewport', (transform, expected) => {
    expect(mappedViewportRect(bbox, transform)).toEqual(expected)
  })

  it('composes viewport rotation and scale with the stored page-relative transform', () => {
    const metrics = viewportImageMetrics([0, 2, 2, 0, 0, 0], 15, 3)
    expect(metrics.angleRad).toBeCloseTo((105 * Math.PI) / 180)
    expect(metrics.scale).toBeCloseTo(6)
  })
})

describe('detail interaction decisions', () => {
  it('lets a left-button image hit win over the active Pan tool', () => {
    expect(detailPointerIntent(true, 0, 'pan', true, false)).toBe('detailImage')
  })

  it('keeps middle-button panning in detail mode', () => {
    expect(detailPointerIntent(true, 1, 'draw', true, false)).toBe('pan')
  })

  it('uses ordinary Pan behavior outside detail mode', () => {
    expect(detailPointerIntent(false, 0, 'pan', false, false)).toBe('pan')
  })

  it('allows native Ctrl/Cmd+V only while editing a detail page', () => {
    expect(shouldUseNativeDetailPaste(true, { key: 'v', ctrlKey: true, metaKey: false })).toBe(true)
    expect(shouldUseNativeDetailPaste(false, { key: 'v', ctrlKey: true, metaKey: false })).toBe(
      false
    )
  })
})

describe('detail summary interaction decisions', () => {
  it('lets the summary win over image dragging and Pan', () => {
    expect(detailPointerIntent(true, 0, 'pan', true, true)).toBe('detailSummary')
  })

  it('still uses image dragging outside the summary', () => {
    expect(detailPointerIntent(true, 0, 'pan', true, false)).toBe('detailImage')
  })

  it('maps arrows to source-space movement using approved increments', () => {
    expect(detailKeyboardDelta('ArrowLeft', false)).toEqual({ x: -1, y: 0 })
    expect(detailKeyboardDelta('ArrowUp', false)).toEqual({ x: 0, y: 1 })
    expect(detailKeyboardDelta('ArrowDown', true)).toEqual({ x: 0, y: -10 })
    expect(detailKeyboardDelta('Enter', false)).toBeNull()
  })

  it('converts a summary drag delta to source-space without zoom drift', () => {
    expect(
      summaryPositionAfterDrag({ x: 20, y: 80 }, { x: 100, y: 100 }, { x: 125, y: 90 })
    ).toEqual({ x: 45, y: 70 })
  })

  it('maps CSS summary size through a rotated viewport into source extents', () => {
    // 90° transform [0, 2, 2, 0, …]: screen width → source y, screen height → source x.
    expect(summarySourceSizeFromCss(100, 40, 1, [0, 2, 2, 0, 0, 0])).toEqual({ w: 20, h: 50 })
    // Unrotated scale 2, zoom 2: CSS/(scale*zoom).
    expect(summarySourceSizeFromCss(100, 40, 2, [2, 0, 0, -2, 0, 400])).toEqual({ w: 25, h: 10 })
  })

  it('clamps a rotated top-edge anchor so the CSS box stays inside padded bounds', () => {
    // 90° [0,2,2,0]: CSS box extends +x/+y in source, not the unrotated -y direction.
    const bounds = { x: 80, y: 190, w: 440, h: 220 }
    const transform = [0, 2, 2, 0, 0, 0] as const
    const offsets = summarySourceOffsetsFromCss(100, 40, 1, transform)
    expect(offsets).toEqual({ dxMin: 0, dxMax: 20, dyMin: 0, dyMax: 50 })

    const topEdge = { x: bounds.x, y: bounds.y + bounds.h }
    const clamped = clampDetailSummaryAnchor(topEdge, bounds, offsets)
    expect(clamped).toEqual({ x: 80, y: 360 })
    expect(clamped.x + offsets.dxMin).toBeGreaterThanOrEqual(bounds.x)
    expect(clamped.x + offsets.dxMax).toBeLessThanOrEqual(bounds.x + bounds.w)
    expect(clamped.y + offsets.dyMin).toBeGreaterThanOrEqual(bounds.y)
    expect(clamped.y + offsets.dyMax).toBeLessThanOrEqual(bounds.y + bounds.h)
  })

  it('keeps a 90-degree default top-left anchor fully inside padded bounds', () => {
    const bounds = { x: 80, y: 190, w: 440, h: 220 }
    // Measured card size in CSS px; zoom 1, 90° viewport.
    const offsets = summarySourceOffsetsFromCss(280, 85, 1, [0, 2, 2, 0, 0, 0])
    const defaultTopLeft = { x: bounds.x, y: bounds.y + bounds.h }
    const displayed = clampDetailSummaryAnchor(defaultTopLeft, bounds, offsets)
    expect(displayed.x + offsets.dxMin).toBeGreaterThanOrEqual(bounds.x)
    expect(displayed.x + offsets.dxMax).toBeLessThanOrEqual(bounds.x + bounds.w)
    expect(displayed.y + offsets.dyMin).toBeGreaterThanOrEqual(bounds.y)
    expect(displayed.y + offsets.dyMax).toBeLessThanOrEqual(bounds.y + bounds.h)
    // Default top-left would overflow +y under this transform; display clamp pulls it in.
    expect(displayed.y).toBeLessThan(defaultTopLeft.y)
  })
})

describe('detail image import', () => {
  it('returns null instead of leaking decode failures', async () => {
    const importer = vi.fn(async () => {
      throw new Error('bad image')
    })
    await expect(tryImportDetailImage(new Blob(), importer)).resolves.toBeNull()
  })
})

describe('detail presentation', () => {
  it('labels stores but not facility measurements', () => {
    expect(shouldDrawDetailTag('facility')).toBe(false)
    expect(shouldDrawDetailTag('store')).toBe(true)
  })

  it('uses the approved shared image opacity', () => {
    expect(DETAIL_IMAGE_OPACITY).toBe(0.9)
  })
})
