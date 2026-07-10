import { describe, expect, it } from 'vitest'

import {
  clampLegendTopLeft,
  defaultLegendTopLeft,
  DEFAULT_LEGEND_INSET_PT,
  legendGeometry
} from './legendLayout'

describe('legend layout', () => {
  it('places the default legend inset from the page top-left', () => {
    expect(defaultLegendTopLeft(800)).toEqual({
      x: DEFAULT_LEGEND_INSET_PT,
      y: 800 - DEFAULT_LEGEND_INSET_PT
    })
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

describe('legendGeometry', () => {
  it('lays out a vertical legend (k=1)', () => {
    const geo = legendGeometry([40, 20], 'vertical', 1)
    expect(geo.width).toBe(80)
    expect(geo.height).toBe(64)
    expect(geo.slots[0]).toEqual({ swatchX: 10, swatchY: 15, textX: 30, textY: 21 })
    expect(geo.slots[1].textY).toBe(43)
  })

  it('lays out a horizontal legend as a single row (k=1)', () => {
    const geo = legendGeometry([40, 20], 'horizontal', 1)
    expect(geo.width).toBe(136)
    expect(geo.height).toBe(42)
    expect(geo.slots[0].swatchX).toBe(10)
    expect(geo.slots[1].swatchX).toBe(86)
    expect(geo.slots[1].textX).toBe(106)
  })

  it('scales every field linearly with k', () => {
    const base = legendGeometry([40, 20], 'vertical', 1)
    const scaled = legendGeometry([80, 40], 'vertical', 2)
    expect(scaled.width).toBe(base.width * 2)
    expect(scaled.height).toBe(base.height * 2)
    scaled.slots.forEach((slot, i) => {
      expect(slot.swatchX).toBe(base.slots[i].swatchX * 2)
      expect(slot.swatchY).toBe(base.slots[i].swatchY * 2)
      expect(slot.textX).toBe(base.slots[i].textX * 2)
      expect(slot.textY).toBe(base.slots[i].textY * 2)
    })
  })
})
