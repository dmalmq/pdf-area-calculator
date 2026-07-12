import { describe, expect, it } from 'vitest'

import { detailFit, facilityDetailBBox } from './detailFit'
import type { Area } from '../state/types'

const rect = (
  pageIndex: number,
  name: string,
  kind: Area['kind'],
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Area => ({
  id: crypto.randomUUID(),
  pageIndex,
  kind,
  name,
  polygon: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 }
  ]
})

describe('facilityDetailBBox', () => {
  it('returns null when nothing matches', () => {
    expect(facilityDetailBBox([], 'A', 0)).toBeNull()
    expect(facilityDetailBBox([rect(0, 'A', 'facility', 0, 0, 10, 10)], 'B', 0)).toBeNull()
    expect(facilityDetailBBox([rect(0, 'A', 'facility', 0, 0, 10, 10)], 'A', 1)).toBeNull()
  })

  it('returns the bbox of a single polygon', () => {
    expect(facilityDetailBBox([rect(0, 'A', 'facility', 2, 3, 12, 8)], 'A', 0)).toEqual({
      x: 2,
      y: 3,
      w: 10,
      h: 5
    })
  })

  it('unions facility and store polygons on the same page', () => {
    const areas = [
      rect(0, 'A', 'facility', 0, 0, 10, 10),
      rect(0, 'A', 'store', 12, -4, 16, 6),
      rect(0, 'A', 'facility', 1, 1, 20, 20) // holes irrelevant; outer ring wins
    ]
    expect(facilityDetailBBox(areas, 'A', 0)).toEqual({ x: 0, y: -4, w: 20, h: 24 })
  })

  it('ignores areas from other pages or names', () => {
    const areas = [
      rect(0, 'A', 'facility', 0, 0, 10, 10),
      rect(1, 'A', 'facility', 0, 0, 100, 100),
      rect(0, 'B', 'facility', 0, 0, 100, 100)
    ]
    expect(facilityDetailBBox(areas, 'A', 0)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
})

describe('detailFit', () => {
  it('fits a square bbox with 5% padding into a matching square area', () => {
    // paddedW = paddedH = 110; scale = 110/110 = 1; centered => no offset
    const fit = detailFit({ x: 0, y: 0, w: 100, h: 100 }, { width: 110, height: 110 })
    expect(fit.scale).toBeCloseTo(1, 6)
    expect(fit.offsetX).toBeCloseTo(0, 6)
    expect(fit.offsetY).toBeCloseTo(0, 6)
  })

  it('binds on width for a wide bbox and centers vertically', () => {
    // paddedW = 220, paddedH = 110; scale = min(220/220, 220/110) = 1
    // offsetX = (220 - 220)/2 = 0; offsetY = (220 - 110)/2 = 55
    const fit = detailFit({ x: 0, y: 0, w: 200, h: 100 }, { width: 220, height: 220 })
    expect(fit.scale).toBeCloseTo(1, 6)
    expect(fit.offsetX).toBeCloseTo(0, 6)
    expect(fit.offsetY).toBeCloseTo(55, 6)
  })

  it('binds on height for a tall bbox and centers horizontally', () => {
    // paddedW = 110, paddedH = 220; scale = min(220/110, 220/220) = 1
    // offsetX = (220 - 110)/2 = 55; offsetY = 0
    const fit = detailFit({ x: 0, y: 0, w: 100, h: 200 }, { width: 220, height: 220 })
    expect(fit.scale).toBeCloseTo(1, 6)
    expect(fit.offsetX).toBeCloseTo(55, 6)
    expect(fit.offsetY).toBeCloseTo(0, 6)
  })

  it('maps the bbox center to the center of the available area', () => {
    const bbox = { x: 10, y: 20, w: 100, h: 100 }
    const avail = { width: 110, height: 110 }
    const { scale, offsetX, offsetY } = detailFit(bbox, avail)
    const paddedX = bbox.x - 0.05 * bbox.w
    const paddedY = bbox.y - 0.05 * bbox.h
    const center = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }
    const tx = (center.x - paddedX) * scale + offsetX
    const ty = (center.y - paddedY) * scale + offsetY
    expect(tx).toBeCloseTo(avail.width / 2, 6)
    expect(ty).toBeCloseTo(avail.height / 2, 6)
  })

  it('down-scales when the padded bbox is larger than the available area', () => {
    // paddedW = paddedH = 220; scale = 110/220 = 0.5
    const fit = detailFit({ x: 0, y: 0, w: 200, h: 200 }, { width: 110, height: 110 })
    expect(fit.scale).toBeCloseTo(0.5, 6)
    expect(fit.offsetX).toBeCloseTo(0, 6)
    expect(fit.offsetY).toBeCloseTo(0, 6)
  })

  it('returns a finite transform centering a point bbox in the available area', () => {
    const avail = { width: 110, height: 220 }
    const fit = detailFit({ x: 10, y: 20, w: 0, h: 0 }, avail)
    expect(fit.scale).toBeCloseTo(1, 6)
    expect(fit.offsetX).toBeCloseTo(55, 6)
    expect(fit.offsetY).toBeCloseTo(110, 6)
    // the point maps to the center of avail
    const tx = (10 - 10) * fit.scale + fit.offsetX
    const ty = (20 - 20) * fit.scale + fit.offsetY
    expect(tx).toBeCloseTo(avail.width / 2, 6)
    expect(ty).toBeCloseTo(avail.height / 2, 6)
  })

  it('fits on the nonzero dimension when the bbox has zero width', () => {
    // paddedW = 0, paddedH = 110; scale binds on height = 220/110 = 2
    // offsetX = 220/2 = 110 (centers the degenerate x); offsetY = 0
    const fit = detailFit({ x: 5, y: 0, w: 0, h: 100 }, { width: 220, height: 220 })
    expect(fit.scale).toBeCloseTo(2, 6)
    expect(fit.offsetX).toBeCloseTo(110, 6)
    expect(fit.offsetY).toBeCloseTo(0, 6)
  })
})
