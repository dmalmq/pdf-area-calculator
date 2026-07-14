import { describe, expect, it, vi } from 'vitest'
import { OPS } from 'pdfjs-dist'

import { collectSegments, pageVectorLines } from './vectorLines'

function pack(
  subOps: number[],
  subArgs: number[]
): [number[], number[], number[]] {
  return [subOps, subArgs, [0, 0, 0, 0]]
}

describe('collectSegments', () => {
  it('emits stroked polyline segments', () => {
    const { segments, truncated } = collectSegments(
      [OPS.constructPath, OPS.stroke],
      [
        pack(
          [OPS.moveTo, OPS.lineTo, OPS.lineTo],
          [0, 0, 10, 0, 10, 20]
        ),
        null
      ]
    )
    expect(truncated).toBe(false)
    expect(segments).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 10, y: 20 } }
    ])
  })

  it('emits four edges for a rectangle', () => {
    const { segments } = collectSegments(
      [OPS.constructPath, OPS.stroke],
      [pack([OPS.rectangle], [0, 0, 10, 20]), null]
    )
    expect(segments).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 10, y: 20 } },
      { a: { x: 10, y: 20 }, b: { x: 0, y: 20 } },
      { a: { x: 0, y: 20 }, b: { x: 0, y: 0 } }
    ])
  })

  it('emits a single segment for a degenerate rectangle (height 0)', () => {
    const { segments } = collectSegments(
      [OPS.constructPath, OPS.stroke],
      [pack([OPS.rectangle], [5, 7, 10, 0]), null]
    )
    expect(segments).toEqual([{ a: { x: 5, y: 7 }, b: { x: 15, y: 7 } }])
  })

  it('skips clip-only paths', () => {
    const { segments } = collectSegments(
      [OPS.constructPath, OPS.clip, OPS.endPath],
      [pack([OPS.rectangle], [0, 0, 10, 10]), null, null]
    )
    expect(segments).toEqual([])
  })

  it('applies cm transforms with save/restore scoping', () => {
    const { segments } = collectSegments(
      [
        OPS.save,
        OPS.transform,
        OPS.constructPath,
        OPS.stroke,
        OPS.restore,
        OPS.constructPath,
        OPS.stroke
      ],
      [
        null,
        [2, 0, 0, 2, 5, 7],
        pack([OPS.moveTo, OPS.lineTo], [1, 1, 2, 1]),
        null,
        null,
        pack([OPS.moveTo, OPS.lineTo], [1, 1, 2, 1]),
        null
      ]
    )
    expect(segments).toEqual([
      { a: { x: 7, y: 9 }, b: { x: 9, y: 9 } },
      { a: { x: 1, y: 1 }, b: { x: 2, y: 1 } }
    ])
  })

  it('closes back to the moveTo point on closePath', () => {
    const { segments } = collectSegments(
      [OPS.constructPath, OPS.closeStroke],
      [
        pack(
          [OPS.moveTo, OPS.lineTo, OPS.lineTo, OPS.closePath],
          [0, 0, 10, 0, 10, 10]
        ),
        null
      ]
    )
    expect(segments).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 10, y: 10 } },
      { a: { x: 10, y: 10 }, b: { x: 0, y: 0 } }
    ])
  })

  it('flattens béziers so chords start and end at exact endpoints', () => {
    const { segments } = collectSegments(
      [OPS.constructPath, OPS.stroke],
      [
        pack(
          [OPS.moveTo, OPS.curveTo],
          [0, 0, 0, 10, 10, 10, 10, 0]
        ),
        null
      ]
    )
    expect(segments.length).toBe(8)
    expect(segments[0].a).toEqual({ x: 0, y: 0 })
    expect(segments[segments.length - 1].b).toEqual({ x: 10, y: 0 })
    for (let i = 0; i < segments.length - 1; i += 1) {
      expect(segments[i].b).toEqual(segments[i + 1].a)
    }
  })

  it('caps segment count and sets truncated at the limit', () => {
    const subOps = [OPS.moveTo]
    const subArgs = [0, 0]
    for (let i = 1; i <= 20; i += 1) {
      subOps.push(OPS.lineTo)
      subArgs.push(i, 0)
    }
    const { segments, truncated } = collectSegments(
      [OPS.constructPath, OPS.stroke],
      [pack(subOps, subArgs), null],
      5
    )
    expect(truncated).toBe(true)
    expect(segments).toHaveLength(5)
  })
})

describe('pageVectorLines', () => {
  it('memoizes getOperatorList results per page proxy', async () => {
    const getOperatorList = vi.fn(async () => ({
      fnArray: [OPS.constructPath, OPS.stroke],
      argsArray: [pack([OPS.moveTo, OPS.lineTo], [0, 0, 1, 0]), null]
    }))
    const page = { getOperatorList }

    const a = await pageVectorLines(page)
    const b = await pageVectorLines(page)

    expect(getOperatorList).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(a.segments).toEqual([{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }])
  })
})
