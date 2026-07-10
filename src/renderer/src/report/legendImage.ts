import type { LegendEntry, LegendOrientation } from '../state/types'
import { LEGEND_LAYOUT, legendGeometry, REPORT_FONT_FAMILY } from './legendLayout'

const FONT_FAMILY = REPORT_FONT_FAMILY
const { swatch: SWATCH, font: FONT } = LEGEND_LAYOUT

export interface LegendPng {
  png: Uint8Array
  width: number // CSS px (= PDF points here, dpr-independent)
  height: number
}

export async function renderLegendPng(
  entries: LegendEntry[],
  orientation: LegendOrientation = 'vertical',
  scale = 1
): Promise<LegendPng> {
  const dpr = 2
  const canvas = document.createElement('canvas')
  const measureCtx = canvas.getContext('2d')
  if (!measureCtx) throw new Error('Canvas 2D context unavailable')
  const font = FONT * scale
  measureCtx.font = `${font}px ${FONT_FAMILY}`
  const widths = entries.map((entry) => measureCtx.measureText(entry.name).width)
  const geo = legendGeometry(widths, orientation, scale)
  const { width, height } = geo

  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.scale(dpr, dpr)

  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#9ca3af'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1)
  ctx.font = `${font}px ${FONT_FAMILY}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  entries.forEach((entry, i) => {
    const slot = geo.slots[i]
    ctx.fillStyle = entry.color
    ctx.fillRect(slot.swatchX, slot.swatchY, SWATCH * scale, SWATCH * scale)
    ctx.fillStyle = '#111827'
    ctx.fillText(entry.name, slot.textX, slot.textY)
  })

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('PNG rendering failed'))), 'image/png')
  })
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height }
}
