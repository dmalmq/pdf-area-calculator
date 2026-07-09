import { describe, expect, it } from 'vitest'

import { clampLegendTopLeft, defaultLegendTopLeft, DEFAULT_LEGEND_INSET_PT } from './legendLayout'

describe('legend layout', () => {
  it('places the default legend inset from the page top-left', () => {
    expect(defaultLegendTopLeft(800)).toEqual({ x: DEFAULT_LEGEND_INSET_PT, y: 800 - DEFAULT_LEGEND_INSET_PT })
  })

  it('keeps a legend inside the page bounds', () => {
    // page 500x800, box 120x60
    expect(clampLegendTopLeft({ x: 50, y: 700 }, 500, 800, 120, 60)).toEqual({ x: 50, y: 700 })
    // dragged past the right/bottom edges → clamped so the whole box stays on
    expect(clampLegendTopLeft({ x: 999, y: 10 }, 500, 800, 120, 60)).toEqual({ x: 380, y: 60 })
    // dragged past the left/top edges → clamped to the corner
    expect(clampLegendTopLeft({ x: -50, y: 999 }, 500, 800, 120, 60)).toEqual({ x: 0, y: 800 })
  })

  it('does not produce a negative x when the box is wider than the page', () => {
    expect(clampLegendTopLeft({ x: 10, y: 400 }, 100, 800, 200, 60).x).toBe(0)
  })
})
