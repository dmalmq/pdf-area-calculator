import { inverseImagePoint, pointInImageRect, scaleDetailAboutCursor } from './PdfStage'

import { describe, expect, it } from 'vitest'

import {
  anchoredZoomScroll,
  constrainDelta,
  detailFrame,
  doubleClickAction,
  shouldPanPointer,
  tagBoxSize
} from './PdfStage'

describe('PdfStage interaction helpers', () => {
  it('uses middle mouse as pan without treating it as a drawing click', () => {
    expect(shouldPanPointer(1, 'draw')).toBe(true)
    expect(shouldPanPointer(1, 'edit')).toBe(true)
    expect(shouldPanPointer(0, 'pan')).toBe(true)
    expect(shouldPanPointer(0, 'draw')).toBe(false)
  })

  it('keeps the same local point under the cursor when zoom changes', () => {
    expect(
      anchoredZoomScroll({
        scrollLeft: 100,
        scrollTop: 50,
        localX: 200,
        localY: 150,
        zoom: 1,
        nextZoom: 2
      })
    ).toEqual({ x: 400, y: 250 })
  })

  it('locks drag to the dominant axis when requested', () => {
    expect(constrainDelta({ x: 5, y: 2 }, false)).toEqual({ x: 5, y: 2 })
    expect(constrainDelta({ x: 5, y: 2 }, true)).toEqual({ x: 5, y: 0 })
    expect(constrainDelta({ x: 2, y: 5 }, true)).toEqual({ x: 0, y: 5 })
    expect(constrainDelta({ x: 3, y: 3 }, true)).toEqual({ x: 3, y: 0 })
  })

  it('treats a double-click as select unless a polygon is in progress', () => {
    expect(doubleClickAction(0)).toBe('selectArea')
    expect(doubleClickAction(2)).toBe('selectArea')
    expect(doubleClickAction(3)).toBe('closeDraft')
  })
})

describe('tagBoxSize', () => {
  it('sizes a one-line tag: widest line + padding, one line-height + padding', () => {
    expect(tagBoxSize([40])).toEqual({ width: 60, height: 31 })
  })

  it('sizes a two-line tag to the widest line and grows taller per line', () => {
    expect(tagBoxSize([120, 30])).toEqual({ width: 140, height: 46 })
  })

  it('falls back to padding-only when there are no lines', () => {
    expect(tagBoxSize([])).toEqual({ width: 20, height: 16 })
  })
})

describe('detailFrame', () => {
  it('fits the bbox rect to the container and centers it (margin-aware)', () => {
    // rect 100x100 viewport-px at (10,20); container 500x400; 32px stage margin.
    // fit = min(500/100, 400/100) = 4.
    // pan.x = 32 + 10*4 - (500 - 100*4)/2 = 72 - 50 = 22
    // pan.y = 32 + 20*4 - (400 - 100*4)/2 = 112 - 0 = 112
    expect(
      detailFrame({
        rectX: 10,
        rectY: 20,
        rectW: 100,
        rectH: 100,
        containerW: 500,
        containerH: 400,
        margin: 32
      })
    ).toEqual({ zoom: 4, pan: { x: 22, y: 112 } })
  })

  it('clamps the framing zoom to the stage zoom range', () => {
    const framed = detailFrame({
      rectX: 0,
      rectY: 0,
      rectW: 1,
      rectH: 1,
      containerW: 5000,
      containerH: 5000,
      margin: 0
    })
    expect(framed.zoom).toBe(8)
  })
})

describe('inverseImagePoint', () => {
  it('inverse-maps a viewport point to image-local pixels (no rotation)', () => {
    // center at (100,100) viewport-px, 2 viewport-px per image-px, 10x10 image.
    expect(inverseImagePoint({ x: 100, y: 100 }, { x: 100, y: 100 }, 2, 0, 10, 10)).toEqual({
      x: 5,
      y: 5
    })
    expect(inverseImagePoint({ x: 102, y: 100 }, { x: 100, y: 100 }, 2, 0, 10, 10)).toEqual({
      x: 6,
      y: 5
    })
  })

  it('un-rotates by the transform rotation before scaling into image space', () => {
    // rotated 90°: a point 2px below center maps back onto the +x image axis.
    const r = inverseImagePoint({ x: 100, y: 102 }, { x: 100, y: 100 }, 2, Math.PI / 2, 10, 10)
    expect(r.x).toBeCloseTo(6)
    expect(r.y).toBeCloseTo(5)
  })
})

describe('pointInImageRect', () => {
  it('accepts points inside the image rect and rejects points outside', () => {
    expect(pointInImageRect({ x: 5, y: 5 }, 10, 10)).toBe(true)
    expect(pointInImageRect({ x: 0, y: 10 }, 10, 10)).toBe(true)
    expect(pointInImageRect({ x: -1, y: 5 }, 10, 10)).toBe(false)
    expect(pointInImageRect({ x: 11, y: 5 }, 10, 10)).toBe(false)
  })
})

describe('scaleDetailAboutCursor', () => {
  it('keeps the cursor-anchored image point fixed while scaling', () => {
    // cursor at the image top-left corner (PDF 0,0) → scaling leaves top-left in place.
    expect(
      scaleDetailAboutCursor({ x: 0, y: 0, scale: 1, rotation: 0 }, 10, 10, { x: 0, y: 0 }, 2)
    ).toEqual({ x: 0, y: 0, scale: 2, rotation: 0 })
  })

  it('moves the top-left so the cursor stays anchored when it is off-corner', () => {
    // image top-left (0,0), scale 1, 10x10 → center PDF (5,-5). Cursor at center, factor 2.
    // center is fixed, so new top-left = (5 - 10*2/2, -5 + 10*2/2) = (-5, 5).
    const r = scaleDetailAboutCursor({ x: 0, y: 0, scale: 1, rotation: 0 }, 10, 10, { x: 5, y: -5 }, 2)
    expect(r.x).toBeCloseTo(-5)
    expect(r.y).toBeCloseTo(5)
    expect(r.scale).toBeCloseTo(2)
    expect(r.rotation).toBe(0)
  })
})
