import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderLegendPng } from './legendImage'
import type { LegendEntry } from '../state/types'

const entries: LegendEntry[] = [
  { name: 'A', color: '#2563eb' },
  { name: 'B', color: '#dc2626' }
]

// Canvas stub whose measured text width scales with the current font size
// (40px at the base 13px font), mirroring real canvas text scaling. This keeps
// the legend geometry a true linear function of the scale factor.
function setupCanvas(): { drawnText: string[] } {
  const drawnText: string[] = []
  let fontPx = 13
  const ctx = {
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn((text: string) => drawnText.push(text)),
    measureText: vi.fn(() => ({ width: 40 * (fontPx / 13) })),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set font(value: string) {
      fontPx = Number.parseFloat(value)
    },
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
    set lineWidth(_v: number) {}
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

describe('renderLegendPng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders a non-empty PNG with positive dimensions', async () => {
    const { drawnText } = setupCanvas()

    const out = await renderLegendPng(entries)

    expect(out.png.length).toBeGreaterThan(0)
    expect(out.width).toBeGreaterThan(0)
    expect(out.height).toBeGreaterThan(0)
    expect(drawnText).toContain('A')
    expect(drawnText).toContain('B')
  })

  it('lays out a horizontal legend as a single wide row', async () => {
    setupCanvas()

    const out = await renderLegendPng(entries, 'horizontal')

    expect(out.width).toBeGreaterThan(out.height)
    expect(out.height).toBe(42)
  })

  it('scales the whole legend by the scale factor', async () => {
    setupCanvas()
    const base = await renderLegendPng(entries, 'vertical')
    setupCanvas()
    const scaled = await renderLegendPng(entries, 'vertical', 2)

    expect(scaled.width).toBe(base.width * 2)
    expect(scaled.height).toBe(base.height * 2)
  })
})
