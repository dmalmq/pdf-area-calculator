import { describe, expect, it } from 'vitest'

import { anchoredZoomScroll, constrainDelta, shouldPanPointer } from './PdfStage'

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
})
