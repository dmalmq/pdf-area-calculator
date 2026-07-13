import { afterEach, describe, expect, it, vi } from 'vitest'

import { measureDetailSummarySize, renderDetailSummaryPng } from './detailHeader'

// Canvas stub: measureText width scales with text length; fillText calls are
// collected so we can assert the summary drew name, metrics, and labels.
function setupCanvas(): { drawnText: string[] } {
  const drawnText: string[] = []
  const ctx = {
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn((text: string) => drawnText.push(text)),
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
    toBlob: vi.fn((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' }))
    )
  }
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
  return { drawnText }
}

describe('renderDetailSummaryPng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('draws facility, floor, area, stores, and table headings', async () => {
    const { drawnText } = setupCanvas()
    const out = await renderDetailSummaryPng({
      name: 'エスパル仙台本館',
      level: 'B1F',
      area: '1,284.50 m²',
      stores: '33',
      labels: { floor: 'Floor', area: 'Area', stores: 'Stores' }
    })

    expect(out.png.length).toBeGreaterThan(0)
    expect(out.width).toBeGreaterThan(out.height)
    expect(drawnText).toEqual(
      expect.arrayContaining([
        'エスパル仙台本館',
        'B1F',
        '1,284.50 m²',
        '33',
        'Floor',
        'Area',
        'Stores'
      ])
    )
  })

  it('draws the explicit uncalibrated value', async () => {
    const { drawnText } = setupCanvas()
    await renderDetailSummaryPng({
      name: 'Central Mall',
      level: '2F',
      area: 'Not calibrated',
      stores: '0',
      labels: { floor: 'Floor', area: 'Area', stores: 'Stores' }
    })
    expect(drawnText).toContain('Not calibrated')
  })

  it('wraps a long facility name within the maximum width', async () => {
    setupCanvas()
    const out = await renderDetailSummaryPng({
      name: 'A very long facility name that cannot fit on one line without wrapping',
      level: '4F',
      area: '8,200.00 m²',
      stores: '91',
      labels: { floor: 'Floor', area: 'Area', stores: 'Stores' },
      maxWidth: 320
    })
    expect(out.width).toBeLessThanOrEqual(320)
    expect(out.height).toBeGreaterThan(60)
  })

  it('hard-breaks an unbreakable overwide token without exceeding maxWidth', async () => {
    const { drawnText } = setupCanvas()
    // Spaced string with one token wider than the card: word-wrap must hard-break it.
    const long = 'X'.repeat(80)
    const out = await renderDetailSummaryPng({
      name: `Prefix ${long} Suffix`,
      level: '1F',
      area: '10.00 m²',
      stores: '1',
      labels: { floor: 'Floor', area: 'Area', stores: 'Stores' },
      maxWidth: 200
    })
    expect(out.width).toBeLessThanOrEqual(200)
    const xFragments = drawnText.filter((s) => /^X+$/.test(s))
    expect(xFragments.length).toBeGreaterThan(1)
    for (const frag of xFragments) {
      expect(frag.length * 8).toBeLessThanOrEqual(200 - 24)
    }
  })
})

describe('measureDetailSummarySize', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('matches renderDetailSummaryPng dimensions and grows for wrapped names', () => {
    setupCanvas()
    const labels = { floor: 'Floor', area: 'Area', stores: 'Stores' }
    const shortInput = {
      name: 'Mall',
      level: '1F',
      area: '10.00 m²',
      stores: '1',
      labels
    }
    const longInput = {
      name: 'A very long facility name that cannot fit on one line without wrapping',
      level: '1F',
      area: '10.00 m²',
      stores: '1',
      labels,
      maxWidth: 320
    }
    const short = measureDetailSummarySize(shortInput)
    const long = measureDetailSummarySize(longInput)
    expect(long.h).toBeGreaterThan(short.h)
    expect(long.w).toBeLessThanOrEqual(320)
  })

  it('agrees with renderDetailSummaryPng width and height', async () => {
    setupCanvas()
    const input = {
      name: 'Central Mall',
      level: 'B1F',
      area: '100.00 m²',
      stores: '3',
      labels: { floor: 'Floor', area: 'Area', stores: 'Stores' }
    }
    const measured = measureDetailSummarySize(input)
    const rendered = await renderDetailSummaryPng(input)
    expect(measured).toEqual({ w: rendered.width, h: rendered.height })
  })
})
