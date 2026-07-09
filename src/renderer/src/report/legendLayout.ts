import type { Pt } from '../state/types'

// Single source of truth for legend + report typography and geometry, shared by
// the on-canvas overlay (PdfStage) and the exported PNGs (legendImage/reportImage)
// so the editing view and the exported PDF stay in sync.

// Full CJK-capable stack — facility names are Japanese.
export const REPORT_FONT_FAMILY = '"Yu Gothic UI","Yu Gothic","Meiryo","MS Gothic",sans-serif'

export const LEGEND_LAYOUT = { rowH: 22, padding: 10, swatch: 12, gap: 8, font: 13 }

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
