import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderDetailHeaderPng } from './detailHeader'

// Canvas stub: measureText width scales with text length; fillText calls are
// collected so we can assert the strip drew both the name and the level.
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

describe('renderDetailHeaderPng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders a non-empty PNG strip with plausible dimensions', async () => {
    const { drawnText } = setupCanvas()

    const out = await renderDetailHeaderPng('エスパル仙台本館', '1F')

    expect(out.png.length).toBeGreaterThan(0)
    expect(out.width).toBeGreaterThan(0)
    expect(out.height).toBeGreaterThan(0)
    // A header is a wide, short strip.
    expect(out.width).toBeGreaterThan(out.height)
    expect(drawnText).toContain('エスパル仙台本館')
    expect(drawnText.some((s) => s.includes('1F'))).toBe(true)
  })
})
