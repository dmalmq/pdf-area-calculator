import { REPORT_FONT_FAMILY } from './legendLayout'

const FONT_FAMILY = REPORT_FONT_FAMILY
const MAX_WIDTH = 360
const MIN_WIDTH = 280
const PAD_X = 12
const PAD_Y = 10
const NAME_SIZE = 15
const BODY_SIZE = 13
const LABEL_SIZE = 11
const LINE_HEIGHT = 19
const TABLE_GAP = 8

export interface DetailSummaryRenderInput {
  name: string
  level: string
  area: string
  stores: string
  labels: { floor: string; area: string; stores: string }
  maxWidth?: number
}

export interface DetailSummaryPng {
  png: Uint8Array
  width: number // CSS px (= PDF points when embedded 1:1)
  height: number
}

type Measure = (text: string) => number

// Hard-break by measured characters; a single glyph wider than maxWidth is still
// emitted alone (cannot shrink further without clipping mid-glyph).
function breakByChars(text: string, maxWidth: number, measure: Measure): string[] {
  if (text.length === 0) return ['']
  if (measure(text) <= maxWidth) return [text]
  const lines: string[] = []
  let current = ''
  for (const ch of text) {
    const candidate = current + ch
    if (current && measure(candidate) > maxWidth) {
      lines.push(current)
      current = ch
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

// Wrap by measured words for spaced scripts and by characters for unspaced CJK.
// Any single token wider than maxWidth is hard-broken by characters so nothing
// paints past the content edge.
function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  if (text.length === 0) return ['']
  if (measure(text) <= maxWidth) return [text]
  if (!/\s/.test(text)) return breakByChars(text, maxWidth, measure)

  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (measure(word) > maxWidth) {
      if (current) {
        lines.push(current)
        current = ''
      }
      const pieces = breakByChars(word, maxWidth, measure)
      for (let i = 0; i < pieces.length - 1; i += 1) lines.push(pieces[i])
      current = pieces[pieces.length - 1] ?? ''
      continue
    }
    const candidate = current ? `${current} ${word}` : word
    if (current && measure(candidate) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

function maxLineWidth(lines: string[], measure: Measure): number {
  let max = 0
  for (const line of lines) max = Math.max(max, measure(line))
  return max
}

export async function renderDetailSummaryPng(
  input: DetailSummaryRenderInput
): Promise<DetailSummaryPng> {
  const dpr = 2
  const canvas = document.createElement('canvas')
  const measureCtx = canvas.getContext('2d')
  if (!measureCtx) throw new Error('Canvas 2D context unavailable')

  const maxWidth = input.maxWidth ?? MAX_WIDTH
  const innerMax = Math.max(0, maxWidth - PAD_X * 2)

  const measureAt = (size: number, weight: '' | 'bold ' = ''): Measure => {
    return (text: string) => {
      measureCtx.font = `${weight}${size}px ${FONT_FAMILY}`
      return measureCtx.measureText(text).width
    }
  }

  const measureName = measureAt(NAME_SIZE, 'bold ')
  const measureBody = measureAt(BODY_SIZE)
  const measureLabel = measureAt(LABEL_SIZE)

  const nameLines = wrapText(input.name, innerMax, measureName)
  const nameBlockW = maxLineWidth(nameLines, measureName)

  const colGap = TABLE_GAP
  // Natural column widths from single-line content.
  let floorLabelLines = [input.labels.floor]
  let areaLabelLines = [input.labels.area]
  let storesLabelLines = [input.labels.stores]
  let floorValueLines = [input.level]
  let areaValueLines = [input.area]
  let storesValueLines = [input.stores]

  let floorColW = Math.max(measureLabel(input.labels.floor), measureBody(input.level))
  let areaColW = Math.max(measureLabel(input.labels.area), measureBody(input.area))
  let storesColW = Math.max(measureLabel(input.labels.stores), measureBody(input.stores))
  let tableW = floorColW + areaColW + storesColW + colGap * 2

  // Grow the card for the table up to maxWidth. If the table still overflows
  // the inner budget, wrap each column's text into a proportional share so the
  // row never paints past the right edge.
  if (tableW > innerMax) {
    const avail = Math.max(0, innerMax - colGap * 2)
    const totalNat = floorColW + areaColW + storesColW || 1
    floorColW = Math.max(1, Math.floor((avail * floorColW) / totalNat))
    areaColW = Math.max(1, Math.floor((avail * areaColW) / totalNat))
    storesColW = Math.max(1, avail - floorColW - areaColW)
    floorLabelLines = wrapText(input.labels.floor, floorColW, measureLabel)
    areaLabelLines = wrapText(input.labels.area, areaColW, measureLabel)
    storesLabelLines = wrapText(input.labels.stores, storesColW, measureLabel)
    floorValueLines = wrapText(input.level, floorColW, measureBody)
    areaValueLines = wrapText(input.area, areaColW, measureBody)
    storesValueLines = wrapText(input.stores, storesColW, measureBody)
    floorColW = Math.max(maxLineWidth(floorLabelLines, measureLabel), maxLineWidth(floorValueLines, measureBody))
    areaColW = Math.max(maxLineWidth(areaLabelLines, measureLabel), maxLineWidth(areaValueLines, measureBody))
    storesColW = Math.max(maxLineWidth(storesLabelLines, measureLabel), maxLineWidth(storesValueLines, measureBody))
    tableW = floorColW + areaColW + storesColW + colGap * 2
    // Final safety: never claim more than innerMax for the table band.
    if (tableW > innerMax) {
      storesColW = Math.max(1, storesColW - (tableW - innerMax))
      tableW = floorColW + areaColW + storesColW + colGap * 2
    }
  }

  const contentW = Math.max(nameBlockW, tableW)
  const width = Math.min(maxWidth, Math.max(MIN_WIDTH, Math.ceil(PAD_X * 2 + contentW)))
  const nameH = nameLines.length * LINE_HEIGHT
  const labelRows = Math.max(floorLabelLines.length, areaLabelLines.length, storesLabelLines.length)
  const valueRows = Math.max(floorValueLines.length, areaValueLines.length, storesValueLines.length)
  const height = PAD_Y * 2 + nameH + TABLE_GAP + labelRows * LINE_HEIGHT + valueRows * LINE_HEIGHT

  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.scale(dpr, dpr)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#8f9b94'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1)

  // Facility name (may wrap)
  ctx.fillStyle = '#26362f'
  ctx.font = `bold ${NAME_SIZE}px ${FONT_FAMILY}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  let y = PAD_Y + LINE_HEIGHT / 2
  for (const line of nameLines) {
    ctx.fillText(line, PAD_X, y)
    y += LINE_HEIGHT
  }

  // Table: three columns — floor | area | stores
  y += TABLE_GAP
  const floorX = PAD_X
  const areaX = floorX + floorColW + colGap
  const storesX = areaX + areaColW + colGap
  const areaRight = areaX + areaColW
  const storesRight = storesX + storesColW

  const drawColumnLines = (
    lines: string[],
    x: number,
    align: 'left' | 'right',
    startY: number,
    color: string,
    size: number
  ): void => {
    ctx.fillStyle = color
    ctx.font = `${size}px ${FONT_FAMILY}`
    ctx.textAlign = align
    let rowY = startY
    for (const line of lines) {
      ctx.fillText(line, x, rowY + LINE_HEIGHT / 2)
      rowY += LINE_HEIGHT
    }
  }

  const labelY = y
  drawColumnLines(floorLabelLines, floorX, 'left', labelY, '#65756d', LABEL_SIZE)
  drawColumnLines(areaLabelLines, areaRight, 'right', labelY, '#65756d', LABEL_SIZE)
  drawColumnLines(storesLabelLines, storesRight, 'right', labelY, '#65756d', LABEL_SIZE)

  const valueY = labelY + labelRows * LINE_HEIGHT
  drawColumnLines(floorValueLines, floorX, 'left', valueY, '#26362f', BODY_SIZE)
  drawColumnLines(areaValueLines, areaRight, 'right', valueY, '#26362f', BODY_SIZE)
  drawColumnLines(storesValueLines, storesRight, 'right', valueY, '#26362f', BODY_SIZE)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('PNG rendering failed'))),
      'image/png'
    )
  })
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height }
}
