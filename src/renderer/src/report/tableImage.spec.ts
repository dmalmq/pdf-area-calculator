import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderTablePng } from './tableImage'
import type { ReportRow } from '../state/types'

const rows: ReportRow[] = [
  { name: 'エスパル仙台本館', scaledM2: 12.345, unscaledPt2: 0, count: 2 },
  { name: 'JR仙台駅', scaledM2: 0, unscaledPt2: 12345, count: 1 }
]

describe('renderTablePng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('draws the summary table headers, CJK names, totals, and unscaled column', async () => {
    const drawnText: string[] = []
    const ctx = {
      scale: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn((text: string) => drawnText.push(text)),
      measureText: vi.fn((text: string) => ({ width: text.length * 12 }))
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })))
    }

    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })

    const bytes = await renderTablePng(rows, '面積集計 — sample.pdf', true)

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(drawnText).toContain('面積集計 — sample.pdf')
    expect(drawnText).toContain('事業所 / Business')
    expect(drawnText).toContain('未スケール (pt²)')
    expect(drawnText).toContain('エスパル仙台本館')
    expect(drawnText).toContain('JR仙台駅')
    expect(drawnText).toContain('12.35')
    expect(drawnText).toContain('1.23e+4')
    expect(drawnText).toContain('Total')
  })
})
