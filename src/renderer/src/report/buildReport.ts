import { PDFDocument, rgb, StandardFonts, type PDFFont, type RGB } from 'pdf-lib'

import type { Area, LegendEntry, LegendOrientation, Pt, StoreLabelMode } from '../state/types'
import { storeTagLabel } from '../state/storeLabel'
import { colorForName } from '../utils/colors'
import { renderLegendPng } from './legendImage'
import { clampLegendTopLeft, defaultLegendTopLeft } from './legendLayout'

function colorFromHex(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16)
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)
}

function overlayColor(name: string, colors: Record<string, string>): RGB {
  const custom = colors[name]
  return colorFromHex(/^#[0-9a-f]{6}$/i.test(custom ?? '') ? custom : colorForName(name))
}

// pdf-lib's drawSvgPath flips the Y axis (SVG is y-down from the top-left) and
// anchors at the page origin, so PDF-space (y-up) points would render below the
// page. Convert to top-left space here and pair with `y: pageHeight` at the call.
function svgPath(points: Area['polygon'], pageHeight: number): string {
  return `${points
    .map((pt, index) => `${index === 0 ? 'M' : 'L'} ${pt.x} ${pageHeight - pt.y}`)
    .join(' ')} Z`
}

function centroid(points: Area['polygon']): Pt {
  const sum = points.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

// Store codes are ASCII, so a standard font renders them directly (facility
// names are Japanese and stay unlabeled in-place — the legend names them).
function drawAreaOverlays(
  doc: PDFDocument,
  areas: Area[],
  colors: Record<string, string>,
  codeFont: PDFFont,
  storeLabels: { mode: StoreLabelMode; prefixes: Record<string, string> },
  pageOrder: number[]
): void {
  const pages = doc.getPages()
  const codeSize = 9
  for (const area of areas) {
    const newIndex = pageOrder.indexOf(area.pageIndex)
    if (newIndex < 0 || area.polygon.length < 3) continue
    const page = pages[newIndex]
    if (!page) continue
    const color = overlayColor(area.name, colors)
    const { height } = page.getSize()
    const holePaths = (area.holes ?? [])
      .filter((ring) => ring.length >= 3)
      .map((ring) => svgPath([...ring].reverse(), height))
      .join(' ')
    const overlayPath = holePaths
      ? `${svgPath(area.polygon, height)} ${holePaths}`
      : svgPath(area.polygon, height)
    page.drawSvgPath(overlayPath, {
      x: 0,
      y: height,
      color,
      opacity: 0.12,
      borderColor: color,
      borderOpacity: 0.9,
      borderWidth: 1.5
    })

    if (area.kind === 'store') {
      const label = storeTagLabel(area.code, storeLabels.prefixes[area.name], storeLabels.mode)
      if (label) {
        const c = centroid(area.polygon)
        const textW = codeFont.widthOfTextAtSize(label, codeSize)
        page.drawText(label, {
          x: c.x - textW / 2,
          y: c.y - codeSize / 2,
          size: codeSize,
          font: codeFont,
          color: rgb(0.07, 0.09, 0.15)
        })
      }
    }
  }
}

export interface LegendOptions {
  visible: boolean
  pos: Pt | null // PDF-point top-left; null → default inset
  entriesForPage(pageIndex: number): LegendEntry[]
  orientation: LegendOrientation
  scale: number
}

async function drawLegends(doc: PDFDocument, legend: LegendOptions, pageOrder: number[]): Promise<void> {
  if (!legend.visible) return
  const pages = doc.getPages()
  for (let i = 0; i < pages.length; i += 1) {
    const entries = legend.entriesForPage(pageOrder[i])
    if (!entries.length) continue
    const { png, width, height } = await renderLegendPng(entries, legend.orientation, legend.scale)
    const img = await doc.embedPng(png)
    const page = pages[i]
    const { width: pw, height: ph } = page.getSize()
    const topLeft: Pt = legend.pos ?? defaultLegendTopLeft(ph)
    const { x, y: yTop } = clampLegendTopLeft(topLeft, pw, ph, width, height)
    page.drawImage(img, { x, y: yTop - height, width, height })
  }
}

export async function buildReportPdf(
  originalBytes: Uint8Array,
  png: Uint8Array,
  areas: Area[] = [],
  colors: Record<string, string> = {},
  legend?: LegendOptions,
  storeLabels: { mode: StoreLabelMode; prefixes: Record<string, string> } = {
    mode: 'code',
    prefixes: {}
  },
  pageOrder: number[] = []
): Promise<Uint8Array> {
  const src = await PDFDocument.load(originalBytes)
  const order = pageOrder.length ? pageOrder : src.getPageIndices()
  const doc = await PDFDocument.create()
  const copied = await doc.copyPages(src, order)
  copied.forEach((p) => doc.addPage(p))
  const codeFont = await doc.embedFont(StandardFonts.Helvetica)
  drawAreaOverlays(doc, areas, colors, codeFont, storeLabels, order)
  if (legend) await drawLegends(doc, legend, order)

  const img = await doc.embedPng(png)
  const W = 595.28
  const H = 841.89
  const page = doc.addPage([W, H])
  const margin = 28
  const maxW = W - margin * 2
  const maxH = H - margin * 2
  const scale = Math.min(maxW / img.width, maxH / img.height)
  const w = img.width * scale
  const h = img.height * scale
  page.drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h })

  return doc.save()
}
