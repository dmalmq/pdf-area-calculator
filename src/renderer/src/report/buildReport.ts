import { PDFDocument, rgb, type RGB } from 'pdf-lib'

import type { Area } from '../state/types'
import { colorForName } from '../utils/colors'

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

export async function buildReportPdf(
  originalBytes: Uint8Array,
  png: Uint8Array,
  areas: Area[] = [],
  colors: Record<string, string> = {}
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes)
  drawAreaOverlays(doc, areas, colors)

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
