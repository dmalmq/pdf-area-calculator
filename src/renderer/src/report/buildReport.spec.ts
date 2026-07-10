import { PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { Area } from '../state/types'

import { buildReportPdf } from './buildReport'
import { inflateSync } from 'node:zlib'

// Replays the page-0 content stream's CTM to find where the first traced path
// vertex actually lands in device space — the check that catches an overlay
// flipped off the page.
async function firstOverlayDevicePoint(
  bytes: Uint8Array
): Promise<{ x: number; y: number } | null> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPages()[0]
  const contents = page.node.get(PDFName.of('Contents'))
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents]
  let text = ''
  for (const ref of refs) {
    const stream = doc.context.lookup(ref) as PDFRawStream
    let raw = stream.contents as Uint8Array
    try {
      raw = inflateSync(Buffer.from(raw))
    } catch {
      // stream was not flate-encoded
    }
    text += Buffer.from(raw).toString('latin1') + '\n'
  }
  const toks = text.split(/\s+/)
  let m = [1, 0, 0, 1, 0, 0]
  const mul = (a: number[], b: number[]): number[] => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ]
  for (let i = 0; i < toks.length; i += 1) {
    if (toks[i] === 'cm') m = mul(m, toks.slice(i - 6, i).map(Number))
    if (toks[i] === 'm') {
      const x = Number(toks[i - 2])
      const y = Number(toks[i - 1])
      return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
    }
  }
  return null
}

const onePixelPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3, 253,
  167, 121, 129, 252, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
])

describe('buildReportPdf', () => {
  it('appends an A4 portrait report page without replacing source pages', async () => {
    const source = await PDFDocument.create()
    source.addPage([200, 100])
    source.addPage([300, 150])

    const out = await buildReportPdf(await source.save(), onePixelPng)
    const doc = await PDFDocument.load(out)
    const pages = doc.getPages()

    expect(pages).toHaveLength(3)
    expect(pages[0].getWidth()).toBe(200)
    expect(pages[1].getWidth()).toBe(300)
    expect(pages[2].getWidth()).toBeCloseTo(595.28)
    expect(pages[2].getHeight()).toBeCloseTo(841.89)
  })

  it('draws traced area overlays onto source pages before appending the summary', async () => {
    const source = await PDFDocument.create()
    source.addPage([300, 300])
    const originalBytes = await source.save()
    const area: Area = {
      id: 'area-1',
      pageIndex: 0,
      kind: 'facility',
      name: 'エスパル仙台本館',
      polygon: [
        { x: 20, y: 20 },
        { x: 200, y: 20 },
        { x: 200, y: 160 },
        { x: 20, y: 160 }
      ]
    }

    const withoutOverlay = await buildReportPdf(originalBytes, onePixelPng)
    const withOverlay = await buildReportPdf(originalBytes, onePixelPng, [area])

    expect(withOverlay.length).toBeGreaterThan(withoutOverlay.length)
    expect((await PDFDocument.load(withOverlay)).getPageCount()).toBe(2)
  })

  it('positions area overlays on the page, not flipped off the bottom', async () => {
    const source = await PDFDocument.create()
    source.addPage([300, 300])
    const originalBytes = await source.save()
    const area: Area = {
      id: 'a',
      pageIndex: 0,
      kind: 'facility',
      name: 'A',
      polygon: [
        { x: 40, y: 40 },
        { x: 260, y: 40 },
        { x: 260, y: 260 },
        { x: 40, y: 260 }
      ]
    }

    const out = await buildReportPdf(originalBytes, onePixelPng, [area])
    const dev = await firstOverlayDevicePoint(out)

    expect(dev).not.toBeNull()
    expect(dev!.x).toBeGreaterThanOrEqual(0)
    expect(dev!.x).toBeLessThanOrEqual(300)
    expect(dev!.y).toBeGreaterThanOrEqual(0)
    expect(dev!.y).toBeLessThanOrEqual(300)
  })

  it('labels store polygons with their code on the source pages', async () => {
    const source = await PDFDocument.create()
    source.addPage([300, 300])
    const originalBytes = await source.save()
    const polygon = [
      { x: 20, y: 20 },
      { x: 120, y: 20 },
      { x: 120, y: 120 },
      { x: 20, y: 120 }
    ]
    const withCode: Area = {
      id: 's',
      pageIndex: 0,
      kind: 'store',
      name: 'A',
      code: 'ts001',
      polygon
    }
    const withoutCode: Area = { id: 's', pageIndex: 0, kind: 'store', name: 'A', polygon }

    const labeled = await buildReportPdf(originalBytes, onePixelPng, [withCode])
    const unlabeled = await buildReportPdf(originalBytes, onePixelPng, [withoutCode])

    // The drawn code text adds content the code-less store does not.
    expect(labeled.length).toBeGreaterThan(unlabeled.length)
  })
})

describe('buildReportPdf page order', () => {
  async function threePagePdf(): Promise<Uint8Array> {
    const d = await PDFDocument.create()
    d.addPage([200, 200])
    d.addPage([200, 200])
    d.addPage([200, 200])
    return d.save()
  }

  it('keeps only the pages in pageOrder, in that order, plus the summary page', async () => {
    const src = await threePagePdf()
    const out = await buildReportPdf(src, onePixelPng, [], {}, undefined, { mode: 'code', prefixes: {} }, [
      2,
      0
    ])
    const doc = await PDFDocument.load(out)
    // two kept pages + one appended summary page
    expect(doc.getPageCount()).toBe(3)
  })

  it('defaults to all pages when pageOrder is omitted', async () => {
    const src = await threePagePdf()
    const out = await buildReportPdf(src, onePixelPng)
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(4) // 3 original + summary
  })
})
