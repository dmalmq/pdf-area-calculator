import type { LegendOrientation, Pt } from '../state/types'

// Single source of truth for legend + report typography and geometry, shared by
// the on-canvas overlay (PdfStage) and the exported PNGs (legendImage/reportImage)
// so the editing view and the exported PDF stay in sync.

// Full CJK-capable stack — facility names are Japanese.
export const REPORT_FONT_FAMILY = '"Yu Gothic UI","Yu Gothic","Meiryo","MS Gothic",sans-serif'

export const LEGEND_LAYOUT = { rowH: 22, padding: 10, swatch: 12, gap: 8, font: 13, entryGap: 16 }

// Inset of the default legend position from the page's top-left corner, in PDF points.
export const DEFAULT_LEGEND_INSET_PT = 24

// Default legend top-left in PDF points (bottom-left origin): the box's TOP edge
// sits `inset` below the page top, its LEFT edge `inset` from the page left.
export function defaultLegendTopLeft(pageHeight: number): Pt {
  return { x: DEFAULT_LEGEND_INSET_PT, y: pageHeight - DEFAULT_LEGEND_INSET_PT }
}

// Clamp the box top-left so the whole box stays on the page (PDF points,
// bottom-left origin; `pos.y` is the box's TOP edge, box extends downward).
export function clampLegendTopLeft(
  pos: Pt,
  pageWidth: number,
  pageHeight: number,
  boxWidth: number,
  boxHeight: number
): Pt {
  return {
    x: Math.min(Math.max(pos.x, 0), Math.max(0, pageWidth - boxWidth)),
    y: Math.min(Math.max(pos.y, boxHeight), pageHeight)
  }
}

export interface LegendSlot {
  swatchX: number // swatch top-left, offset from box top-left, y-down
  swatchY: number
  textX: number // text left edge
  textY: number // row vertical center (draw with textBaseline 'middle')
}

export interface LegendGeometry {
  width: number
  height: number
  slots: LegendSlot[] // one per entry, same order
}

// textWidths: entry-name widths measured by the caller at font `LEGEND_LAYOUT.font * k`.
// k: unit scale multiplying every LEGEND_LAYOUT constant (legendScale, and on
// canvas additionally the pdf.js viewport scale).
export function legendGeometry(
  textWidths: number[],
  orientation: LegendOrientation,
  k: number
): LegendGeometry {
  const p = LEGEND_LAYOUT.padding * k
  const s = LEGEND_LAYOUT.swatch * k
  const g = LEGEND_LAYOUT.gap * k
  const r = LEGEND_LAYOUT.rowH * k
  const eg = LEGEND_LAYOUT.entryGap * k
  const n = textWidths.length

  if (orientation === 'vertical') {
    const width = 2 * p + s + g + Math.max(0, ...textWidths)
    const height = 2 * p + n * r
    const slots: LegendSlot[] = textWidths.map((_, i) => {
      const mid = p + i * r + r / 2
      return { swatchX: p, swatchY: mid - s / 2, textX: p + s + g, textY: mid }
    })
    return { width, height, slots }
  }

  const height = 2 * p + r
  const mid = p + r / 2
  let x = p
  const slots: LegendSlot[] = textWidths.map((textWidth, i) => {
    const slot: LegendSlot = { swatchX: x, swatchY: mid - s / 2, textX: x + s + g, textY: mid }
    x += s + g + textWidth
    if (i < n - 1) x += eg
    return slot
  })
  return { width: x + p, height, slots }
}
