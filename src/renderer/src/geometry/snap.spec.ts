import { describe, expect, it } from 'vitest'

import {
  SegmentIndex,
  nearestOnSegment,
  resolveSnap,
  segmentIntersection,
  type Segment,
  type SnapTargets
} from './snap'

const allTargets: SnapTargets = {
  endpoints: true,
  intersections: true,
  lines: true
}

describe('nearestOnSegment', () => {
  it('projects onto the interior of a segment', () => {
    const s: Segment = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    expect(nearestOnSegment({ x: 4, y: 3 }, s)).toEqual({ x: 4, y: 0 })
  })

  it('clamps to endpoints for points past the ends', () => {
    const s: Segment = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    expect(nearestOnSegment({ x: -2, y: 1 }, s)).toEqual({ x: 0, y: 0 })
    expect(nearestOnSegment({ x: 15, y: 1 }, s)).toEqual({ x: 10, y: 0 })
  })
})

describe('segmentIntersection', () => {
  it('returns the crossing point of two closed segments', () => {
    const s1: Segment = { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }
    const s2: Segment = { a: { x: 0, y: 10 }, b: { x: 10, y: 0 } }
    const hit = segmentIntersection(s1, s2)
    expect(hit).not.toBeNull()
    expect(hit!.x).toBeCloseTo(5)
    expect(hit!.y).toBeCloseTo(5)
  })

  it('returns null for parallel or non-overlapping segments', () => {
    const a: Segment = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    const b: Segment = { a: { x: 0, y: 1 }, b: { x: 10, y: 1 } }
    const c: Segment = { a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }
    const d: Segment = { a: { x: 3, y: 0 }, b: { x: 5, y: 0 } }
    expect(segmentIntersection(a, b)).toBeNull()
    expect(segmentIntersection(c, d)).toBeNull()
  })
})

describe('SegmentIndex', () => {
  it('returns a multi-cell segment exactly once from near()', () => {
    // Cell size 10: segment from (5,5) to (25,5) spans cells x=0,1,2 in row y=0.
    const long: Segment = { a: { x: 5, y: 5 }, b: { x: 25, y: 5 } }
    const short: Segment = { a: { x: 0, y: 20 }, b: { x: 1, y: 20 } }
    const index = new SegmentIndex([long, short], 10)

    const hits = index.near({ x: 15, y: 5 }, 2)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toBe(long)
  })
})

describe('resolveSnap', () => {
  it('prefers an endpoint within tolerance over a nearer line point', () => {
    // Horizontal segment; cursor is 1 unit off the mid-line but 3 from the endpoint.
    // Endpoint dist=3, line dist=1; with tol=4 both qualify, endpoint tier wins.
    const seg: Segment = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    const index = new SegmentIndex([seg], 32)
    const hit = resolveSnap({
      pt: { x: 3, y: 1 },
      tolerance: 4,
      targets: allTargets,
      index
    })
    expect(hit).not.toBeNull()
    expect(hit!.kind).toBe('endpoint')
    expect(hit!.pt).toEqual({ x: 0, y: 0 })
  })

  it('excludes candidates outside the tolerance', () => {
    const seg: Segment = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    const index = new SegmentIndex([seg], 32)
    const hit = resolveSnap({
      pt: { x: 5, y: 5 },
      tolerance: 2,
      targets: allTargets,
      index
    })
    expect(hit).toBeNull()
  })

  it('skips disabled tiers', () => {
    const seg: Segment = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    const index = new SegmentIndex([seg], 32)

    // Near endpoint, but endpoints disabled → line hit instead.
    const lineHit = resolveSnap({
      pt: { x: 0.5, y: 1 },
      tolerance: 3,
      targets: { endpoints: false, intersections: false, lines: true },
      index
    })
    expect(lineHit).not.toBeNull()
    expect(lineHit!.kind).toBe('line')
    expect(lineHit!.pt.x).toBeCloseTo(0.5)
    expect(lineHit!.pt.y).toBeCloseTo(0)

    // All tiers off → null.
    expect(
      resolveSnap({
        pt: { x: 0, y: 0 },
        tolerance: 5,
        targets: { endpoints: false, intersections: false, lines: false },
        index
      })
    ).toBeNull()
  })

  it('snaps to the intersection of two crossing segments', () => {
    const s1: Segment = { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }
    const s2: Segment = { a: { x: 0, y: 10 }, b: { x: 10, y: 0 } }
    const index = new SegmentIndex([s1, s2], 32)
    const hit = resolveSnap({
      pt: { x: 5.2, y: 4.8 },
      tolerance: 2,
      targets: { endpoints: false, intersections: true, lines: false },
      index
    })
    expect(hit).not.toBeNull()
    expect(hit!.kind).toBe('intersection')
    expect(hit!.pt.x).toBeCloseTo(5)
    expect(hit!.pt.y).toBeCloseTo(5)
  })

  it('includes extraPoints and extraSegments in the candidate pool', () => {
    // No index segments; only extras.
    const extraSeg: Segment = { a: { x: 100, y: 0 }, b: { x: 110, y: 0 } }
    const endpointHit = resolveSnap({
      pt: { x: 50.5, y: 0.2 },
      tolerance: 2,
      targets: allTargets,
      index: null,
      extraPoints: [{ x: 50, y: 0 }]
    })
    expect(endpointHit).not.toBeNull()
    expect(endpointHit!.kind).toBe('endpoint')
    expect(endpointHit!.pt).toEqual({ x: 50, y: 0 })

    const lineHit = resolveSnap({
      pt: { x: 105, y: 1 },
      tolerance: 2,
      targets: { endpoints: false, intersections: false, lines: true },
      index: null,
      extraSegments: [extraSeg]
    })
    expect(lineHit).not.toBeNull()
    expect(lineHit!.kind).toBe('line')
    expect(lineHit!.pt.x).toBeCloseTo(105)
    expect(lineHit!.pt.y).toBeCloseTo(0)
  })
})
