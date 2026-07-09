import { PDFDocument, rgb, type RGB } from 'pdf-lib'

import type { Area, LegendEntry, Pt } from '../state/types'
import { colorForName } from '../utils/colors'
import { renderLegendPng } from './legendImage'

function colorFromHex(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16)
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)
}

function overlayColor(name: string, colors: Record<string, string>): RGB {
  const custom = colors[name]
  return colorFromHex(/^#[0-9a-f]{6}$/i.test(custom ?? '') ? custom : colorForName(name))
}

function svgPath(points: Area['polygon']): string {
  return `${points.map((pt, index) => `${index === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ')} Z`
}

function drawAreaOverlays(doc: PDFDocument, areas: Area[], colors: Record<string, string>): void {
  const pages = doc.getPages()
  for (const area of areas) {
    const page = pages[area.pageIndex]
    if (!page || area.polygon.length < 3) continue
    const color = overlayColor(area.name, colors)
    page.drawSvgPath(svgPath(area.polygon), {
      color,
      opacity: 0.12,
      borderColor: color,
      borderOpacity: 0.9,
      borderWidth: 1.5
    })
  }
}

export interface LegendOptions {
  visible: boolean
  pos: Pt | null // PDF-point top-left; null → default inset
  entriesForPage(pageIndex: number): LegendEntry[]
}

async function drawLegends(doc: PDFDocument, legend: LegendOptions): Promise<void> {
  if (!legend.visible) return
  const pages = doc.getPages()
  for (let i = 0; i < pages.length; i += 1) {
    const entries = legend.entriesForPage(i)
    if (!entries.length) continue
    const { png, width, height } = await renderLegendPng(entries)
    const img = await doc.embedPng(png)
    const page = pages[i]
    const { width: pw, height: ph } = page.getSize()
    // Default inset: top-left with 24pt margin (PDF origin is bottom-left).
    const topLeft: Pt = legend.pos ?? { x: 24, y: ph - 24 }
    const x = Math.min(Math.max(topLeft.x, 0), Math.max(0, pw - width))
    const yTop = Math.min(Math.max(topLeft.y, height), ph)
    page.drawImage(img, { x, y: yTop - height, width, height })
  }
}

export async function buildReportPdf(
  originalBytes: Uint8Array,
  png: Uint8Array,
  areas: Area[] = [],
  colors: Record<string, string> = {},
  legend?: LegendOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes)
  drawAreaOverlays(doc, areas, colors)
  if (legend) await drawLegends(doc, legend)

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
