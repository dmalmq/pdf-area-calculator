import type { LegendEntry } from '../state/types'

const FONT_FAMILY = '"Yu Gothic UI","Yu Gothic","Meiryo","MS Gothic",sans-serif'
const ROW_H = 22
const PADDING = 10
const SWATCH = 12
const GAP = 8
const FONT = 13

export interface LegendPng {
  png: Uint8Array
  width: number // CSS px (= PDF points here, dpr-independent)
  height: number
}

export async function renderLegendPng(entries: LegendEntry[]): Promise<LegendPng> {
  const dpr = 2
  const canvas = document.createElement('canvas')
  const measureCtx = canvas.getContext('2d')
  if (!measureCtx) throw new Error('Canvas 2D context unavailable')
  measureCtx.font = `${FONT}px ${FONT_FAMILY}`
  const textW = Math.max(0, ...entries.map((e) => measureCtx.measureText(e.name).width))
  const width = PADDING * 2 + SWATCH + GAP + textW
  const height = PADDING * 2 + entries.length * ROW_H

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
  ctx.font = `${FONT}px ${FONT_FAMILY}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  entries.forEach((entry, i) => {
    const rowY = PADDING + i * ROW_H + ROW_H / 2
    ctx.fillStyle = entry.color
    ctx.fillRect(PADDING, rowY - SWATCH / 2, SWATCH, SWATCH)
    ctx.fillStyle = '#111827'
    ctx.fillText(entry.name, PADDING + SWATCH + GAP, rowY)
  })

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('PNG rendering failed'))), 'image/png')
  })
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height }
}
