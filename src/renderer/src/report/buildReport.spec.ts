import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { Area } from '../state/types'

import { buildReportPdf } from './buildReport'

const onePixelPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0,
  0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156,
  99, 248, 15, 4, 0, 9, 251, 3, 253, 167, 121, 129, 252, 0, 0, 0, 0, 73, 69, 78,
  68, 174, 66, 96, 130
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
})
