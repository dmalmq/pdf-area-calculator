import type { ReportRow } from '../state/types'

interface Column {
  header: string
  width: number
  align?: CanvasTextAlign
  value(row: ReportRow, index: number): string
}

const FONT_FAMILY = '"Yu Gothic UI","Yu Gothic","Meiryo","MS Gothic",sans-serif'

function columns(includeUnscaled: boolean): Column[] {
  const base: Column[] = [
    { header: '#', width: 56, align: 'right', value: (_row, index) => String(index + 1) },
    { header: '事業所 / Business', width: 430, value: (row) => row.name },
    { header: '面積 (m²)', width: 170, align: 'right', value: (row) => row.scaledM2.toFixed(2) },
    { header: '件数', width: 90, align: 'right', value: (row) => String(row.count) }
  ]

  if (includeUnscaled) {
    base.push({
      header: '未スケール (pt²)',
      width: 190,
      align: 'right',
      value: (row) => (row.unscaledPt2 ? row.unscaledPt2.toExponential(2) : '')
    })
  }

  return base
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  align: CanvasTextAlign = 'left'
): void {
  ctx.textAlign = align
  ctx.fillText(text, align === 'right' ? x + width - 12 : x + 12, y)
}

export async function renderTablePng(
  rows: ReportRow[],
  title: string,
  includeUnscaled: boolean
): Promise<Uint8Array> {
  const cols = columns(includeUnscaled)
  const dpr = 2
  const margin = 36
  const rowH = 46
  const headerH = 52
  const titleH = 72
  const footerH = 54
  const tableW = cols.reduce((sum, col) => sum + col.width, 0)
  const width = tableW + margin * 2
  const height = titleH + headerH + rowH * rows.length + footerH + margin
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) throw new Error('Canvas 2D context unavailable')

  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.scale(dpr, dpr)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#111827'
  ctx.font = `700 28px ${FONT_FAMILY}`
  ctx.textBaseline = 'middle'
  ctx.fillText(title, margin, 36)

  let y = titleH
  ctx.font = `700 20px ${FONT_FAMILY}`
  ctx.fillStyle = '#f3f4f6'
  ctx.fillRect(margin, y, tableW, headerH)
  ctx.strokeStyle = '#d1d5db'
  ctx.strokeRect(margin, y, tableW, headerH)

  let x = margin
  ctx.fillStyle = '#111827'
  for (const col of cols) {
    drawText(ctx, col.header, x, y + headerH / 2, col.width, col.align)
    x += col.width
  }

  y += headerH
  ctx.font = `20px ${FONT_FAMILY}`
  rows.forEach((row, index) => {
    ctx.fillStyle = index % 2 === 0 ? '#ffffff' : '#fafafa'
    ctx.fillRect(margin, y, tableW, rowH)
    ctx.strokeStyle = '#e5e7eb'
    ctx.strokeRect(margin, y, tableW, rowH)

    x = margin
    ctx.fillStyle = '#111827'
    for (const col of cols) {
      drawText(ctx, col.value(row, index), x, y + rowH / 2, col.width, col.align)
      x += col.width
    }

    y += rowH
  })

  ctx.fillStyle = '#f9fafb'
  ctx.fillRect(margin, y, tableW, footerH)
  ctx.strokeStyle = '#d1d5db'
  ctx.strokeRect(margin, y, tableW, footerH)
  ctx.fillStyle = '#111827'
  ctx.font = `700 20px ${FONT_FAMILY}`
  drawText(ctx, 'Total', margin, y + footerH / 2, cols[0].width + cols[1].width)
  drawText(
    ctx,
    rows.reduce((sum, row) => sum + row.scaledM2, 0).toFixed(2),
    margin + cols[0].width + cols[1].width,
    y + footerH / 2,
    cols[2].width,
    'right'
  )

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result)
      else reject(new Error('PNG rendering failed'))
    }, 'image/png')
  })

  return new Uint8Array(await blob.arrayBuffer())
}
