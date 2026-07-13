import { PDFArray, PDFDocument, PDFName, PDFPage, PDFRawStream } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Area, DetailPage, PageState } from '../state/types'
import { localeStore } from '../i18n'
import { t } from '../i18n'

import { buildReportPdf } from './buildReport'
import * as detailFitModule from '../geometry/detailFit'
import { detailFit, facilityDetailBBox } from '../geometry/detailFit'
import {
  clampDetailSummaryPosition,
  defaultDetailSummaryPosition,
  paddedDetailBounds
} from '../utils/detailSummary'
import { inflateSync } from 'node:zlib'
import * as detailHeader from './detailHeader'

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
  const tokens = text.split(/\s+/)
  let matrix = [1, 0, 0, 1, 0, 0]
  const multiply = (a: number[], b: number[]): number[] => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ]
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === 'cm') matrix = multiply(matrix, tokens.slice(i - 6, i).map(Number))
    if (tokens[i] === 'm') {
      const x = Number(tokens[i - 2])
      const y = Number(tokens[i - 1])
      return {
        x: matrix[0] * x + matrix[2] * y + matrix[4],
        y: matrix[1] * x + matrix[3] * y + matrix[5]
      }
    }
  }
  return null
}

const onePixelPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3, 253,
  167, 121, 129, 252, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
])
const onePixelBase64 = Buffer.from(onePixelPng).toString('base64')

// The detail summary renders through a canvas; the vitest 'node' env has no DOM,
// so stub `document` like legendImage.spec does. toBlob yields a REAL 1x1 PNG so
// pdf-lib's embedPng accepts the summary bytes.
function stubSummaryCanvas(): void {
  const ctx = {
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    set fillStyle(value: string) {
      void value
    },
    set strokeStyle(value: string) {
      void value
    },
    set font(value: string) {
      void value
    },
    set textAlign(value: string) {
      void value
    },
    set textBaseline(value: string) {
      void value
    },
    set lineWidth(value: number) {
      void value
    }
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((cb: BlobCallback) => cb(new Blob([onePixelPng], { type: 'image/png' })))
  }
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
}

function sourcePagesFromLabels(pageLabels: string[]): PageState[] {
  return pageLabels.map((label, pageIndex) => ({
    pageIndex,
    label,
    scale: null
  }))
}

const DETAIL_MARGIN = 28
const A4_SHORT = 595.28
const A4_LONG = 841.89

/** Known fixed size for module-mocked summary renderer in placement tests. */
const MOCK_SUMMARY = { png: onePixelPng, width: 120, height: 60 }

function expectedSummaryDraw(
  area: Area,
  summaryPosition: { x: number; y: number } | undefined,
  summarySize: { width: number; height: number } = MOCK_SUMMARY
): { x: number; y: number; width: number; height: number } {
  const bbox = facilityDetailBBox([area], area.name, area.pageIndex)!
  const landscape = bbox.w > bbox.h
  const pageW = landscape ? A4_LONG : A4_SHORT
  const pageH = landscape ? A4_SHORT : A4_LONG
  const contentX = DETAIL_MARGIN
  const contentY = DETAIL_MARGIN
  const contentW = pageW - DETAIL_MARGIN * 2
  const contentH = pageH - DETAIL_MARGIN * 2
  const fit = detailFit(bbox, { width: contentW, height: contentH })
  const padX = bbox.w * 0.05
  const padY = bbox.h * 0.05
  const mapPt = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: contentX + (p.x - (bbox.x - padX)) * fit.scale + fit.offsetX,
    y: contentY + (p.y - (bbox.y - padY)) * fit.scale + fit.offsetY
  })
  const sourcePosition = summaryPosition ?? defaultDetailSummaryPosition(bbox)
  const sourceSize = {
    w: summarySize.width / fit.scale,
    h: summarySize.height / fit.scale
  }
  const clamped = clampDetailSummaryPosition(
    sourcePosition,
    paddedDetailBounds(bbox),
    sourceSize
  )
  const mappedTopLeft = mapPt(clamped)
  return {
    x: mappedTopLeft.x,
    y: mappedTopLeft.y - summarySize.height,
    width: summarySize.width,
    height: summarySize.height
  }
}

const wideFacility: Area = {
  id: 'wide',
  pageIndex: 0,
  kind: 'facility',
  name: 'エスパル仙台本館',
  polygon: [
    { x: 10, y: 10 },
    { x: 310, y: 10 },
    { x: 310, y: 110 },
    { x: 10, y: 110 }
  ]
}
const tallFacility: Area = {
  id: 'tall',
  pageIndex: 0,
  kind: 'facility',
  name: 'AER',
  polygon: [
    { x: 10, y: 10 },
    { x: 110, y: 10 },
    { x: 110, y: 310 },
    { x: 10, y: 310 }
  ]
}

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
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    doc.addPage([200, 200])
    doc.addPage([200, 200])
    return doc.save()
  }

  it('keeps only the pages in pageOrder, in that order, plus the summary page', async () => {
    const out = await buildReportPdf(
      await threePagePdf(),
      onePixelPng,
      [],
      {},
      undefined,
      { mode: 'code', prefixes: {} },
      [2, 0]
    )
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(3)
  })

  it('defaults to all pages when pageOrder is omitted', async () => {
    const out = await buildReportPdf(await threePagePdf(), onePixelPng)
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(4)
  })
})

describe('buildReportPdf detail pages', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('inserts detail pages between the originals and the summary, preserving input order', async () => {
    stubSummaryCanvas()
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const pageLabels = ['1F']
    const detail = {
      pages: [
        { name: 'エスパル仙台本館', pageIndex: 0 },
        { name: 'AER', pageIndex: 0 }
      ] as DetailPage[],
      areas: [wideFacility, tallFacility],
      pageLabels,
      sourcePages: sourcePagesFromLabels(pageLabels)
    }

    const out = await buildReportPdf(
      await source.save(),
      onePixelPng,
      [],
      {},
      undefined,
      undefined,
      [],
      detail
    )
    const pages = (await PDFDocument.load(out)).getPages()

    // 1 original + 2 detail + 1 summary table.
    expect(pages).toHaveLength(4)
    // Order preserved: wide facility (landscape) then tall facility (portrait).
    expect(pages[1].getWidth()).toBeCloseTo(841.89)
    expect(pages[1].getHeight()).toBeCloseTo(595.28)
    expect(pages[2].getWidth()).toBeCloseTo(595.28)
    expect(pages[2].getHeight()).toBeCloseTo(841.89)
    // Summary table stays last, A4 portrait.
    expect(pages[3].getWidth()).toBeCloseTo(595.28)
    expect(pages[3].getHeight()).toBeCloseTo(841.89)
  })

  it('orients a detail page landscape when its facility bbox is wider than tall', async () => {
    stubSummaryCanvas()
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const pageLabels = ['1F']
    const detail = {
      pages: [{ name: 'エスパル仙台本館', pageIndex: 0 }] as DetailPage[],
      areas: [wideFacility],
      pageLabels,
      sourcePages: sourcePagesFromLabels(pageLabels)
    }

    const pages = (
      await PDFDocument.load(
        await buildReportPdf(
          await source.save(),
          onePixelPng,
          [],
          {},
          undefined,
          undefined,
          [],
          detail
        )
      )
    ).getPages()

    expect(pages[1].getWidth()).toBeGreaterThan(pages[1].getHeight())
  })

  it('skips detail entries whose facility has no polygons on the page', async () => {
    stubSummaryCanvas()
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const pageLabels = ['1F']
    const detail = {
      pages: [{ name: '存在しない施設', pageIndex: 0 }] as DetailPage[],
      areas: [wideFacility],
      pageLabels,
      sourcePages: sourcePagesFromLabels(pageLabels)
    }

    const pages = (
      await PDFDocument.load(
        await buildReportPdf(
          await source.save(),
          onePixelPng,
          [],
          {},
          undefined,
          undefined,
          [],
          detail
        )
      )
    ).getPages()

    // No detail page added: 1 original + 1 summary.
    expect(pages).toHaveLength(2)
  })

  it('renders a vector-only detail page when the entry has no image', async () => {
    stubSummaryCanvas()
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const pageLabels = ['1F']
    const detail = {
      pages: [{ name: 'エスパル仙台本館', pageIndex: 0 }] as DetailPage[],
      areas: [wideFacility],
      pageLabels,
      sourcePages: sourcePagesFromLabels(pageLabels)
    }

    const pages = (
      await PDFDocument.load(
        await buildReportPdf(
          await source.save(),
          onePixelPng,
          [],
          {},
          undefined,
          undefined,
          [],
          detail
        )
      )
    ).getPages()

    // 1 original + 1 detail (no image) + 1 summary.
    expect(pages).toHaveLength(3)
  })

  it('embeds the background image when the entry has one', async () => {
    stubSummaryCanvas()
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const originalBytes = await source.save()
    const pageLabels = ['1F']
    const base = {
      pages: [{ name: 'エスパル仙台本館', pageIndex: 0 }] as DetailPage[],
      areas: [wideFacility],
      pageLabels,
      sourcePages: sourcePagesFromLabels(pageLabels)
    }
    const withImage = {
      ...base,
      pages: [
        {
          name: 'エスパル仙台本館',
          pageIndex: 0,
          image: onePixelBase64,
          transform: { x: 20, y: 100, scale: 2, rotation: 15 }
        }
      ] as DetailPage[]
    }

    const noImg = await buildReportPdf(
      originalBytes,
      onePixelPng,
      [],
      {},
      undefined,
      undefined,
      [],
      base
    )
    stubSummaryCanvas()
    const img = await buildReportPdf(
      originalBytes,
      onePixelPng,
      [],
      {},
      undefined,
      undefined,
      [],
      withImage
    )

    // The embedded background adds content the vector-only page lacks.
    expect(img.length).toBeGreaterThan(noImg.length)
  })

  it('draws the detail background with the shared preview opacity', async () => {
    stubSummaryCanvas()
    const drawImage = vi.spyOn(PDFPage.prototype, 'drawImage')
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const pageLabels = ['1F']
    const detail = {
      pages: [
        {
          name: 'エスパル仙台本館',
          pageIndex: 0,
          image: onePixelBase64,
          transform: { x: 20, y: 100, scale: 2, rotation: 0 }
        }
      ] as DetailPage[],
      areas: [wideFacility],
      pageLabels,
      sourcePages: sourcePagesFromLabels(pageLabels)
    }

    await buildReportPdf(await source.save(), onePixelPng, [], {}, undefined, undefined, [], detail)

    expect(drawImage.mock.calls.some(([, options]) => options?.opacity === 0.9)).toBe(true)
  })

  it('centers the padded facility bbox in the content area (detailFit contract)', () => {
    const bbox = { x: 100, y: 200, w: 300, h: 100 }
    const avail = { width: 500, height: 400 }
    const fit = detailFit(bbox, avail)
    const padX = bbox.w * 0.05
    const padY = bbox.h * 0.05
    // The mapping the export applies (avail-local, before the content-area shift):
    const map = (p: { x: number; y: number }): { x: number; y: number } => ({
      x: (p.x - (bbox.x - padX)) * fit.scale + fit.offsetX,
      y: (p.y - (bbox.y - padY)) * fit.scale + fit.offsetY
    })
    const center = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }
    const mapped = map(center)
    expect(mapped.x).toBeCloseTo(avail.width / 2)
    expect(mapped.y).toBeCloseTo(avail.height / 2)
  })

  it('uses an explicit source-space summary position and does not reserve a fixed header band', async () => {
    const summaryRenderer = vi
      .spyOn(detailHeader, 'renderDetailSummaryPng')
      .mockResolvedValue(MOCK_SUMMARY)
    const detailFitSpy = vi.spyOn(detailFitModule, 'detailFit')
    const drawImage = vi.spyOn(PDFPage.prototype, 'drawImage')
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const sourceBytes = await source.save()
    const facilityA: Area = { ...wideFacility, id: 'a', name: 'A' }
    const areas = [facilityA]
    const pageLabels = ['1F']
    const summaryPosition = { x: 25, y: 90 }
    const detailPage = {
      name: 'A',
      pageIndex: 0,
      summaryPosition
    } as DetailPage
    // Landscape A4 for wide facility: 841.89 x 595.28
    const detailPageWidth = A4_LONG
    const detailPageHeight = A4_SHORT

    const bytes = await buildReportPdf(
      sourceBytes,
      onePixelPng,
      areas,
      {},
      undefined,
      { mode: 'code', prefixes: {} },
      [0],
      {
        pages: [detailPage],
        areas,
        pageLabels,
        sourcePages: sourcePagesFromLabels(pageLabels)
      }
    )
    const output = await PDFDocument.load(bytes)
    expect(output.getPageCount()).toBe(3)
    expect(summaryRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'A', level: '1F', stores: '0' })
    )
    expect(detailFitSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        width: expect.closeTo(detailPageWidth - 56),
        height: expect.closeTo(detailPageHeight - 56)
      })
    )
    const expected = expectedSummaryDraw(facilityA, summaryPosition)
    const summaryCall = drawImage.mock.calls.find(
      ([, options]) =>
        options?.width === expected.width && options?.height === expected.height
    )
    expect(summaryCall).toBeDefined()
    expect(summaryCall![1]?.x).toBeCloseTo(expected.x)
    expect(summaryCall![1]?.y).toBeCloseTo(expected.y)
  })

  it('uses the deterministic default summary position without mutating DetailPage', async () => {
    vi.spyOn(detailHeader, 'renderDetailSummaryPng').mockResolvedValue(MOCK_SUMMARY)
    const drawImage = vi.spyOn(PDFPage.prototype, 'drawImage')
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const facilityA: Area = { ...wideFacility, id: 'a', name: 'A' }
    const areas = [facilityA]
    const pageLabels = ['1F']
    const detail = { name: 'A', pageIndex: 0 } as DetailPage
    await buildReportPdf(
      await source.save(),
      onePixelPng,
      areas,
      {},
      undefined,
      { mode: 'code', prefixes: {} },
      [0],
      {
        pages: [detail],
        areas,
        pageLabels,
        sourcePages: sourcePagesFromLabels(pageLabels)
      }
    )
    expect(detail).toEqual({ name: 'A', pageIndex: 0 })
    const expected = expectedSummaryDraw(facilityA, undefined)
    const summaryCall = drawImage.mock.calls.find(
      ([, options]) =>
        options?.width === expected.width && options?.height === expected.height
    )
    expect(summaryCall).toBeDefined()
    expect(summaryCall![1]?.x).toBeCloseTo(expected.x)
    expect(summaryCall![1]?.y).toBeCloseTo(expected.y)
  })

  it('labels an uncalibrated detail summary instead of reporting pt² as m²', async () => {
    stubSummaryCanvas()
    const previousLocale = localeStore.getState().locale
    localeStore.getState().setLocale('en')
    try {
      const summaryRenderer = vi.spyOn(detailHeader, 'renderDetailSummaryPng')
      const source = await PDFDocument.create()
      source.addPage([400, 400])
      const pageLabels = ['1F']
      const detail = {
        pages: [{ name: 'エスパル仙台本館', pageIndex: 0 }] as DetailPage[],
        areas: [wideFacility],
        pageLabels,
        // scale: null → uncalibrated
        sourcePages: sourcePagesFromLabels(pageLabels)
      }

      await buildReportPdf(
        await source.save(),
        onePixelPng,
        [],
        {},
        undefined,
        undefined,
        [],
        detail
      )

      expect(summaryRenderer).toHaveBeenCalledWith(
        expect.objectContaining({ area: t('detail.notCalibrated') })
      )
      expect(summaryRenderer).toHaveBeenCalledWith(
        expect.objectContaining({ area: 'Not calibrated' })
      )
    } finally {
      localeStore.getState().setLocale(previousLocale)
    }
  })
})
