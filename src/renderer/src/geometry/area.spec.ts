import { describe, expect, it } from 'vitest'

import {
  areaNetPt2,
  areaToM2,
  pointInArea,
  pointInPolygon,
  polygonCentroid,
  shoelacePt2
} from './area'
import { resolveMmPerPt } from './scale'

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 }
]

describe('geometry helpers', () => {
  it('computes unsigned polygon area in square points', () => {
    expect(shoelacePt2(square)).toBe(10000)
    expect(shoelacePt2(square.toReversed())).toBe(10000)
    expect(shoelacePt2(square.slice(0, 2))).toBe(0)
  })

  it('classifies points inside polygons', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false)
    expect(pointInPolygon({ x: 50, y: 50 }, square.slice(0, 2))).toBe(false)
  })

  it('resolves drawing ratio scale from points to millimetres', () => {
    expect(resolveMmPerPt({ kind: 'ratio', n: 1 })).toBeCloseTo(25.4 / 72)
  })

  it('resolves calibration scale from a measured line', () => {
    expect(
      resolveMmPerPt({
        kind: 'calibration',
        a: { x: 0, y: 0 },
        b: { x: 100, y: 0 },
        realMeters: 10
      })
    ).toBe(100)
  })

  it('converts square points to square metres when scaled', () => {
    const mmPerPt = resolveMmPerPt({ kind: 'ratio', n: 1 })
    expect(areaToM2(10000, mmPerPt)).toBeCloseTo((10000 * (25.4 / 72) ** 2) / 1_000_000)
    expect(areaToM2(10000, null)).toBeNull()
  })

  it('averages polygon vertices for the centroid', () => {
    expect(polygonCentroid(square)).toEqual({ x: 50, y: 50 })
    expect(polygonCentroid([{ x: 2, y: 4 }])).toEqual({ x: 2, y: 4 })
    expect(polygonCentroid([])).toEqual({ x: 0, y: 0 })
  })

  it('subtracts holes from the net area, clamped at zero', () => {
    const hole = [
      { x: 40, y: 40 },
      { x: 60, y: 40 },
      { x: 60, y: 60 },
      { x: 40, y: 60 }
    ]
    expect(areaNetPt2({ polygon: square })).toBe(10000)
    expect(areaNetPt2({ polygon: square, holes: [hole] })).toBe(9600)
    expect(areaNetPt2({ polygon: square, holes: [square] })).toBe(0)
  })

  it('treats hole interiors as outside the area', () => {
    const hole = [
      { x: 40, y: 40 },
      { x: 60, y: 40 },
      { x: 60, y: 60 },
      { x: 40, y: 60 }
    ]
    const area = { polygon: square, holes: [hole] }
    expect(pointInArea(area, { x: 10, y: 10 })).toBe(true)
    expect(pointInArea(area, { x: 50, y: 50 })).toBe(false)
    expect(pointInArea(area, { x: 150, y: 50 })).toBe(false)
  })
})
