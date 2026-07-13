import {
  PDFDocument,
  degrees,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage,
  type RGB
} from 'pdf-lib'
import { DETAIL_IMAGE_OPACITY } from '../utils/detailPage'
import {
  clampDetailSummaryPosition,
  defaultDetailSummaryPosition,
  detailSummaryMetrics,
  paddedDetailBounds
} from '../utils/detailSummary'
import { t } from '../i18n'

import type {
  Area,
  DetailPage,
  LegendEntry,
  LegendOrientation,
  PageState,
  Pt,
  StoreLabelMode
} from '../state/types'
import { storeTagLabel } from '../state/storeLabel'
import { colorForName } from '../utils/colors'
import { detailFit, facilityDetailBBox } from '../geometry/detailFit'
import { renderDetailSummaryPng } from './detailHeader'
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
// anchors at the page origin, so mapped PDF-space (y-up) points must be converted
// to top-left space and paired with `y: pageHeight` at the call.
function svgPath(points: Pt[], pageHeight: number): string {
  return `${points
    .map((pt, index) => `${index === 0 ? 'M' : 'L'} ${pt.x} ${pageHeight - pt.y}`)
    .join(' ')} Z`
}

function centroid(points: Pt[]): Pt {
  const sum = points.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

// Store codes are ASCII, so a standard font renders them directly (facility
// names are Japanese and stay unlabeled in-place — the legend names them).
// `targetPage` overrides the per-area source page (detail pages draw every
// passed area onto one freshly added page). `mapPt` transforms every vertex and
// the store-tag centroid from source-page PDF points into the target page's PDF
// points (identity on original pages, the detail fit on detail pages).
function drawAreaOverlays(
  doc: PDFDocument,
  areas: Area[],
  colors: Record<string, string>,
  codeFont: PDFFont,
  storeLabels: { mode: StoreLabelMode; prefixes: Record<string, string> },
  targetPage: PDFPage | null = null,
  mapPt: (pt: Pt) => Pt = (point) => point,
  pageOrder: number[] = doc.getPageIndices()
): void {
  const pages = doc.getPages()
  // Derive the linear zoom the mapper applies (1 on original pages, the detail
  // fit scale on detail pages) so store codes grow with the zoom; clamp to keep
  // them legible without ballooning.
  const origin = mapPt({ x: 0, y: 0 })
  const unit = mapPt({ x: 1, y: 0 })
  const mapScale = Math.hypot(unit.x - origin.x, unit.y - origin.y)
  const codeSize = Math.max(6, Math.min(18, 9 * mapScale))
  for (const area of areas) {
    const sourceIndex = pageOrder.indexOf(area.pageIndex)
    const page = targetPage ?? (sourceIndex >= 0 ? pages[sourceIndex] : undefined)
    if (!page || area.polygon.length < 3) continue
    const color = overlayColor(area.name, colors)
    const { height } = page.getSize()
    const holePaths = (area.holes ?? [])
      .filter((ring) => ring.length >= 3)
      .map((ring) => svgPath([...ring].reverse().map(mapPt), height))
      .join(' ')
    const mapped = area.polygon.map(mapPt)
    const overlayPath = holePaths
      ? `${svgPath(mapped, height)} ${holePaths}`
      : svgPath(mapped, height)
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
        const c = mapPt(centroid(area.polygon))
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

async function drawLegends(
  doc: PDFDocument,
  legend: LegendOptions,
  pageOrder: number[]
): Promise<void> {
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

export interface DetailOptions {
  pages: DetailPage[] // caller passes pre-sorted (facility order, then page); order preserved
  areas: Area[]
  pageLabels: string[] // indexed by pageIndex
  /** Source page state (labels + scales) for detailSummaryMetrics. */
  sourcePages: PageState[]
}

const A4_SHORT = 595.28
const A4_LONG = 841.89
const DETAIL_MARGIN = 28

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function drawDetailPages(
  doc: PDFDocument,
  detail: DetailOptions,
  colors: Record<string, string>,
  codeFont: PDFFont,
  storeLabels: { mode: StoreLabelMode; prefixes: Record<string, string> }
): Promise<void> {
  for (const dp of detail.pages) {
    const bbox = facilityDetailBBox(detail.areas, dp.name, dp.pageIndex)
    if (!bbox) continue // stale entry: facility has no polygons on this page

    const landscape = bbox.w > bbox.h
    const pageW = landscape ? A4_LONG : A4_SHORT
    const pageH = landscape ? A4_SHORT : A4_LONG
    const page = doc.addPage([pageW, pageH])

    // Full-margin content area — the movable summary overlays the fit, so no
    // reserved header band.
    const contentX = DETAIL_MARGIN
    const contentY = DETAIL_MARGIN
    const contentW = pageW - DETAIL_MARGIN * 2
    const contentH = pageH - DETAIL_MARGIN * 2
    const fit = detailFit(bbox, { width: contentW, height: contentH })

    // detailFit maps a source PDF point into avail-local coords (origin at the
    // content-area bottom-left, y-up, no flip):
    //   tx = (p.x - paddedBBox.x) * scale + offsetX
    // where paddedBBox pads the bbox 5% each side. Add the content-area
    // bottom-left so results land in this detail page's PDF-point space — the
    // same bottom-left-origin convention the source-page overlays already use,
    // so drawSvgPath / drawText behave identically to the original pages.
    const padX = bbox.w * 0.05
    const padY = bbox.h * 0.05
    const mapPt = (p: Pt): Pt => ({
      x: contentX + (p.x - (bbox.x - padX)) * fit.scale + fit.offsetX,
      y: contentY + (p.y - (bbox.y - padY)) * fit.scale + fit.offsetY
    })

    // 1) Background image (if placed), mapped + rotated through the fit.
    if (dp.image && dp.transform) {
      const t = dp.transform
      const embed = await doc.embedPng(base64ToBytes(dp.image))
      // Source-space image box: (t.x, t.y) is the image's TOP-LEFT corner
      // (visual top = max y) in source PDF points; t.scale = PDF pt per image px.
      const srcW = embed.width * t.scale
      const srcH = embed.height * t.scale
      // Image center in source space (top-left minus half-height in y, since y
      // is up), then mapped onto the page.
      const center = mapPt({ x: t.x + srcW / 2, y: t.y - srcH / 2 })
      // On-page size: source lengths scaled again by the fit zoom.
      const w = srcW * fit.scale
      const h = srcH * fit.scale
      // Rotation: t.rotation is degrees CLOCKWISE-positive as applied on the
      // y-down editing canvas. mapPt is y-up (no flip) and pdf-lib's `rotate`
      // is COUNTERCLOCKWISE-positive in y-up page space, so the same visual
      // rotation is the NEGATED angle: phi = -t.rotation.
      // pdf-lib rotates about the (x,y) LOWER-LEFT anchor, not the center, so
      // solve for the anchor A that puts the image center at `center`:
      //   center = A + R(phi)·(w/2, h/2),  R(phi) = [[cos, -sin], [sin, cos]]
      //   => A = center - R(phi)·(w/2, h/2)
      // giving A = (center.x - (hw·cos - hh·sin), center.y - (hw·sin + hh·cos)).
      const phi = -t.rotation
      const rad = (phi * Math.PI) / 180
      const hw = w / 2
      const hh = h / 2
      const ax = center.x - (hw * Math.cos(rad) - hh * Math.sin(rad))
      const ay = center.y - (hw * Math.sin(rad) + hh * Math.cos(rad))
      page.drawImage(embed, {
        x: ax,
        y: ay,
        width: w,
        height: h,
        rotate: degrees(phi),
        opacity: DETAIL_IMAGE_OPACITY
      })
    }

    // 2) Facility + store overlays for this facility/page, mapped through the fit.
    const facilityAreas = detail.areas.filter(
      (a) => a.name === dp.name && a.pageIndex === dp.pageIndex
    )
    drawAreaOverlays(doc, facilityAreas, colors, codeFont, storeLabels, page, mapPt)

    // 3) Movable summary card: metrics from facility-level report, size stable
    // in output points (1 px = 1 pt), only the top-left anchor maps through the fit.
    const metrics = detailSummaryMetrics(
      { areas: detail.areas, pages: detail.sourcePages },
      dp.name,
      dp.pageIndex
    )
    const level =
      metrics?.level ?? detail.pageLabels[dp.pageIndex] ?? `Page ${dp.pageIndex + 1}`
    const area =
      metrics == null || metrics.areaM2 == null
        ? t('detail.notCalibrated')
        : `${metrics.areaM2.toFixed(2)} m²`
    const stores = String(metrics?.stores ?? 0)
    const summary = await renderDetailSummaryPng({
      name: dp.name,
      level,
      area,
      stores,
      labels: {
        floor: t('detail.summaryFloor'),
        area: t('detail.summaryArea'),
        stores: t('detail.summaryStores')
      }
    })
    const summaryImage = await doc.embedPng(summary.png)
    const sourcePosition = dp.summaryPosition ?? defaultDetailSummaryPosition(bbox)
    const sourceSize = { w: summary.width / fit.scale, h: summary.height / fit.scale }
    const clamped = clampDetailSummaryPosition(
      sourcePosition,
      paddedDetailBounds(bbox),
      sourceSize
    )
    const mappedTopLeft = mapPt(clamped)
    page.drawImage(summaryImage, {
      x: mappedTopLeft.x,
      y: mappedTopLeft.y - summary.height,
      width: summary.width,
      height: summary.height
    })
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
  pageOrder: number[] = [],
  detail?: DetailOptions
): Promise<Uint8Array> {
  const src = await PDFDocument.load(originalBytes)
  const order = pageOrder.length ? pageOrder : src.getPageIndices()
  const doc = await PDFDocument.create()
  const copied = await doc.copyPages(src, order)
  copied.forEach((p) => doc.addPage(p))
  const codeFont = await doc.embedFont(StandardFonts.Helvetica)
  drawAreaOverlays(doc, areas, colors, codeFont, storeLabels, null, (point) => point, order)
  if (legend) await drawLegends(doc, legend, order)
  if (detail) await drawDetailPages(doc, detail, colors, codeFont, storeLabels)

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
