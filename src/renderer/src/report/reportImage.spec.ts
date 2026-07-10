import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderReportPng } from './reportImage'
import type { AppState } from '../state/types'

describe('renderReportPng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('draws the three section titles and the grouped facility/store values', async () => {
    const drawnText: string[] = []
    const ctx = {
      scale: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn((text: string) => drawnText.push(text)),
      measureText: vi.fn((text: string) => ({ width: text.length * 12 }))
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toBlob: vi.fn((callback: BlobCallback) =>
        callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
      )
    }
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })

    const state = {
      pages: [{ pageIndex: 0, label: '1F', scale: { kind: 'custom', mmPerPt: 10 } }],
      areas: [
        // facility square 10x10 pt @ 10 mm/pt = 0.01 m²
        {
          id: 'f',
          pageIndex: 0,
          kind: 'facility',
          name: 'A',
          polygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
          ]
        },
        { id: 's1', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [] },
        { id: 's2', pageIndex: 0, kind: 'store', name: 'A', code: 'ts002', polygon: [] }
      ]
    } as Pick<AppState, 'areas' | 'pages'>

    const bytes = await renderReportPng(state, '面積集計 — sample.pdf')

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
    // title + the three section headers
    expect(drawnText).toContain('面積集計 — sample.pdf')
    expect(drawnText).toContain('レベル別 / By level')
    expect(drawnText).toContain('施設別 / By facility')
    expect(drawnText).toContain('施設×レベル / By facility × level')
    // the level label and the facility name appear as row values
    expect(drawnText).toContain('1F')
    expect(drawnText).toContain('A')
    // two stores counted, facility area measured (0.01 m²); stores never measured
    expect(drawnText).toContain('2')
    expect(drawnText).toContain('0.01')
  })
})
