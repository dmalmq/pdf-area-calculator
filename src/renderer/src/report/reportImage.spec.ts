// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { renderReportPng } from './reportImage'
import type { AppState } from '../state/types'

// jsdom canvas.toBlob is not implemented; stub it to return bytes.
function stubCanvas(): void {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    scale: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), save: vi.fn(), restore: vi.fn(),
    set fillStyle(_v) {}, set strokeStyle(_v) {}, set font(_v) {}, set textAlign(_v) {},
    set textBaseline(_v) {}, set lineWidth(_v) {}
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
  }
}

describe('renderReportPng', () => {
  it('produces a non-empty PNG for a populated state', async () => {
    stubCanvas()
    const state = {
      pages: [{ pageIndex: 0, label: '1F', scale: { kind: 'custom', mmPerPt: 10 } }],
      areas: [
        { id: 'f', pageIndex: 0, kind: 'facility', name: 'A', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
        { id: 's', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [] }
      ]
    } as Pick<AppState, 'areas' | 'pages'>
    const png = await renderReportPng(state, 'Report')
    expect(png.length).toBeGreaterThan(0)
  })
})
