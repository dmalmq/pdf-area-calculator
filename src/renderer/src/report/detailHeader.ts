import { REPORT_FONT_FAMILY } from './legendLayout'

const FONT_FAMILY = REPORT_FONT_FAMILY
const NAME_SIZE = 15 // px, bold facility name
const LEVEL_SIZE = 13 // px, level label
const PAD_X = 12
const PAD_Y = 8
const SEP = ' · '

export interface DetailHeaderPng {
  png: Uint8Array
  width: number // CSS px (= PDF points when embedded 1:1)
  height: number
}

export async function renderDetailHeaderPng(name: string, level: string): Promise<DetailHeaderPng> {
  const dpr = 2
  const canvas = document.createElement('canvas')
  const measureCtx = canvas.getContext('2d')
  if (!measureCtx) throw new Error('Canvas 2D context unavailable')

  measureCtx.font = `bold ${NAME_SIZE}px ${FONT_FAMILY}`
  const nameW = measureCtx.measureText(name).width
  measureCtx.font = `${LEVEL_SIZE}px ${FONT_FAMILY}`
  const tailW = measureCtx.measureText(`${SEP}${level}`).width

  const width = Math.ceil(PAD_X * 2 + nameW + tailW)
  const height = PAD_Y * 2 + NAME_SIZE + 4

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

  const midY = height / 2
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#111827'
  ctx.font = `bold ${NAME_SIZE}px ${FONT_FAMILY}`
  ctx.fillText(name, PAD_X, midY)
  ctx.fillStyle = '#4b5563'
  ctx.font = `${LEVEL_SIZE}px ${FONT_FAMILY}`
  ctx.fillText(`${SEP}${level}`, PAD_X + nameW, midY)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('PNG rendering failed'))),
      'image/png'
    )
  })
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height }
}
