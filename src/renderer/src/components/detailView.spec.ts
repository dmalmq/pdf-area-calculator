import { describe, expect, it, vi } from 'vitest'

import {
  DETAIL_IMAGE_OPACITY,
  detailPointerIntent,
  mappedViewportRect,
  shouldDrawDetailTag,
  shouldUseNativeDetailPaste,
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
    expect(detailPointerIntent(true, 0, 'pan', true)).toBe('detailImage')
  })

  it('keeps middle-button panning in detail mode', () => {
    expect(detailPointerIntent(true, 1, 'draw', true)).toBe('pan')
  })

  it('uses ordinary Pan behavior outside detail mode', () => {
    expect(detailPointerIntent(false, 0, 'pan', false)).toBe('pan')
  })

  it('allows native Ctrl/Cmd+V only while editing a detail page', () => {
    expect(shouldUseNativeDetailPaste(true, { key: 'v', ctrlKey: true, metaKey: false })).toBe(true)
    expect(shouldUseNativeDetailPaste(false, { key: 'v', ctrlKey: true, metaKey: false })).toBe(
      false
    )
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
