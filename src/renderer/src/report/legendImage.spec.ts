import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderLegendPng } from './legendImage'

describe('renderLegendPng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders a non-empty PNG with positive dimensions', async () => {
    const drawnText: string[] = []
    const ctx = {
      scale: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn((text: string) => drawnText.push(text)),
      measureText: vi.fn(() => ({ width: 40 })),
      set fillStyle(_v: string) {},
      set strokeStyle(_v: string) {},
      set font(_v: string) {},
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

    const out = await renderLegendPng([
      { name: 'A', color: '#2563eb' },
      { name: 'B', color: '#dc2626' }
    ])

    expect(out.png.length).toBeGreaterThan(0)
    expect(out.width).toBeGreaterThan(0)
    expect(out.height).toBeGreaterThan(0)
    expect(drawnText).toContain('A')
    expect(drawnText).toContain('B')
  })
})
