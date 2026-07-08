import { describe, expect, it } from 'vitest'

import { anchoredZoomScroll, shouldPanPointer } from './PdfStage'

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
})
