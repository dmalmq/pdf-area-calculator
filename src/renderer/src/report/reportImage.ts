import type { AppState } from '../state/types'
import { reportByFacility, reportByFacilityLevel, reportByLevel } from '../state/store'

const FONT_FAMILY = '"Yu Gothic UI","Yu Gothic","Meiryo","MS Gothic",sans-serif'

interface Col {
  header: string
  width: number
  align?: CanvasTextAlign
  value(row: Record<string, unknown>): string
}

interface Section {
  title: string
  cols: Col[]
  rows: Record<string, unknown>[]
}

const m2 = (v: number): string => v.toFixed(2)

function buildSections(state: Pick<AppState, 'areas' | 'pages'>): Section[] {
  const byLevel = reportByLevel(state)
  const byFacility = reportByFacility(state)
  const byFacLevel = reportByFacilityLevel(state)

  return [
    {
      title: 'レベル別 / By level',
      cols: [
        { header: 'レベル', width: 200, value: (r) => String(r.level) },
        { header: '面積 (m²)', width: 160, align: 'right', value: (r) => m2(Number(r.areaM2)) },
        { header: '施設数', width: 120, align: 'right', value: (r) => String(r.facilities) },
        { header: '店舗数', width: 120, align: 'right', value: (r) => String(r.stores) }
      ],
      rows: byLevel as unknown as Record<string, unknown>[]
    },
    {
      title: '施設別 / By facility',
      cols: [
        { header: '施設名', width: 280, value: (r) => String(r.name) },
        { header: '面積 (m²)', width: 140, align: 'right', value: (r) => m2(Number(r.areaM2)) },
        { header: 'レベル', width: 160, value: (r) => (r.levels as string[]).join(', ') },
        { header: '店舗数', width: 120, align: 'right', value: (r) => String(r.stores) }
      ],
      rows: byFacility as unknown as Record<string, unknown>[]
    },
    {
      title: '施設×レベル / By facility × level',
      cols: [
        { header: '施設名', width: 240, value: (r) => String(r.name) },
        { header: 'レベル', width: 160, value: (r) => String(r.level) },
        { header: '面積 (m²)', width: 140, align: 'right', value: (r) => m2(Number(r.areaM2)) },
        { header: '店舗数', width: 120, align: 'right', value: (r) => String(r.stores) }
      ],
      rows: byFacLevel as unknown as Record<string, unknown>[]
    }
  ]
}

export async function renderReportPng(
  state: Pick<AppState, 'areas' | 'pages'>,
  title: string
): Promise<Uint8Array> {
  const sections = buildSections(state)
  const dpr = 2
  const margin = 36
  const rowH = 40
  const headerH = 44
  const titleH = 64
  const sectionTitleH = 40
  const sectionGap = 24
  const tableW = Math.max(...sections.map((s) => s.cols.reduce((sum, c) => sum + c.width, 0)))
  const width = tableW + margin * 2
  const height =
    titleH +
    sections.reduce((sum, s) => sum + sectionTitleH + headerH + rowH * s.rows.length + sectionGap, 0) +
    margin

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.scale(dpr, dpr)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#111827'
  ctx.textBaseline = 'middle'
  ctx.font = `700 26px ${FONT_FAMILY}`
  ctx.fillText(title, margin, 34)

  let y = titleH
  for (const section of sections) {
    ctx.fillStyle = '#111827'
    ctx.font = `700 18px ${FONT_FAMILY}`
    ctx.textAlign = 'left'
    ctx.fillText(section.title, margin, y + sectionTitleH / 2)
    y += sectionTitleH

    const sw = section.cols.reduce((sum, c) => sum + c.width, 0)
    ctx.font = `700 16px ${FONT_FAMILY}`
    ctx.fillStyle = '#f3f4f6'
    ctx.fillRect(margin, y, sw, headerH)
    ctx.strokeStyle = '#d1d5db'
    ctx.strokeRect(margin, y, sw, headerH)
    let x = margin
    ctx.fillStyle = '#111827'
    for (const col of section.cols) {
      ctx.textAlign = col.align ?? 'left'
      ctx.fillText(col.header, col.align === 'right' ? x + col.width - 12 : x + 12, y + headerH / 2)
      x += col.width
    }
    y += headerH

    ctx.font = `16px ${FONT_FAMILY}`
    section.rows.forEach((row, index) => {
      ctx.fillStyle = index % 2 === 0 ? '#ffffff' : '#fafafa'
      ctx.fillRect(margin, y, sw, rowH)
      ctx.strokeStyle = '#e5e7eb'
      ctx.strokeRect(margin, y, sw, rowH)
      x = margin
      ctx.fillStyle = '#111827'
      for (const col of section.cols) {
        ctx.textAlign = col.align ?? 'left'
        ctx.fillText(col.value(row), col.align === 'right' ? x + col.width - 12 : x + 12, y + rowH / 2)
        x += col.width
      }
      y += rowH
    })
    y += sectionGap
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('PNG rendering failed'))), 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}
