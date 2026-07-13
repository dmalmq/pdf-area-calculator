import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'

import { pointInArea, shoelacePt2 } from '../geometry/area'
import { facilityDetailBBox } from '../geometry/detailFit'
import {
  clampDetailSummaryAnchor,
  detailKeyboardDelta,
  detailPointerIntent,
  detailFrame,
  inverseImagePoint,
  mappedViewportRect,
  pointInImageRect,
  scaleDetailAboutCursor,
  shouldDrawDetailTag,
  summaryPositionAfterDrag,
  summarySourceOffsetsFromCss,
  tryImportDetailImage,
  viewportImageMetrics,
  type ViewportTransform
} from './detailView'
import { DETAIL_IMAGE_OPACITY } from '../utils/detailPage'
import {
  defaultDetailSummaryPosition,
  detailSummaryMetrics,
  paddedDetailBounds,
  resolveDetailSummaryPosition
} from '../utils/detailSummary'
import { measureDetailSummarySize } from '../report/detailHeader'
import { t as translateNow, useT } from '../i18n'
import {
  areaM2,
  areaStore,
  colorForBusiness,
  facilitiesOnPage,
  mmPerPtFor,
  nextStoreCode,
  useAreaStore
} from '../state/store'
import { storeTagLabel } from '../state/storeLabel'
import type { AppState, Area, DetailTransform, LegendOrientation, Pt, Tool } from '../state/types'
import {
  clampLegendTopLeft,
  defaultLegendTopLeft,
  LEGEND_LAYOUT,
  legendGeometry,
  type LegendGeometry,
  REPORT_FONT_FAMILY
} from '../report/legendLayout'

interface PdfStageProps {
  calibrationDraft: Pt[]
  onCalibrationPoint: (pt: Pt) => void
  onToast: (message: string) => void
  loading: boolean
  onOpenPdf: () => void
  holeTarget: string | null
  onHoleComplete: () => void
}

interface DragState {
  kind: 'pan' | 'vertex' | 'area' | 'legend' | 'label' | 'detailImage' | 'detailSummary'
  startClient: Pt
  startPan: Pt
  areaId?: string
  vertexIndex?: number
  startPt?: Pt
  startPolygon?: Pt[]
  startHoles?: Pt[][]
  startLegendPos?: Pt
  startLabelOffset?: Pt
  startTransform?: DetailTransform
  startPosition?: Pt
  pointerId?: number
  moved: boolean
}

interface AnchoredZoomInput {
  scrollLeft: number
  scrollTop: number
  localX: number
  localY: number
  zoom: number
  nextZoom: number
}

export function eventToPdfPt(e: MouseEvent, canvas: HTMLCanvasElement, viewport: PageViewport): Pt {
  const rect = canvas.getBoundingClientRect()
  const vx = (e.clientX - rect.left) * (canvas.width / rect.width)
  const vy = (e.clientY - rect.top) * (canvas.height / rect.height)
  const [pdfX, pdfY] = viewport.convertToPdfPoint(vx, vy)
  return { x: pdfX, y: pdfY }
}

function eventToViewportPt(e: PointerEvent, canvas: HTMLCanvasElement): Pt {
  const rect = canvas.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  }
}

function viewportPt(viewport: PageViewport, pt: Pt): Pt {
  const [x, y] = viewport.convertToViewportPoint(pt.x, pt.y)
  return { x, y }
}

function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function centroid(poly: Pt[]): Pt {
  const sum = poly.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 })
  return { x: sum.x / poly.length, y: sum.y / poly.length }
}

const LEGEND = LEGEND_LAYOUT

const TAG = { font: 13, weight: 600, lineH: 15, padX: 10, padY: 8 }

// `.pdf-stage` margin in main.css; the wrapper's content origin is offset by this
// inside the scroll container, so framing math must add it back.
const STAGE_MARGIN = 32

// Tag box (screen px) sized to its text: widest line + horizontal padding both
// sides; one line-height per line + vertical padding. Auto-grows so long names fit.
export function tagBoxSize(lineWidths: number[]): { width: number; height: number } {
  return {
    width: Math.max(0, ...lineWidths) + TAG.padX * 2,
    height: lineWidths.length * TAG.lineH + TAG.padY * 2
  }
}

// Lines for an area's tag. Facility → name + area. Store → its display label
// (code/number), or [] when the store label is off (no tag drawn).
function tagLines(
  area: Area,
  state: Pick<AppState, 'pages' | 'prefixes' | 'storeLabelMode'>
): string[] {
  if (area.kind === 'store') {
    const label = storeTagLabel(area.code, state.prefixes[area.name], state.storeLabelMode)
    return label == null ? [] : [label]
  }
  const scaled = areaM2(state, area)
  return [area.name, scaled == null ? 'unscaled' : `${scaled.toFixed(2)} m²`]
}

// The tag's screen-px rectangle + lines, or null when there is no tag (off store).
// centroid + labelOffset (PDF pt) → viewport px, auto-sized, centered. Shared by
// the draw path and hit-testing so the drawn box and the grabbable box match.
function tagRect(
  area: Area,
  ctx: CanvasRenderingContext2D,
  viewport: PageViewport,
  state: Pick<AppState, 'pages' | 'prefixes' | 'storeLabelMode'>
): { x: number; y: number; w: number; h: number; lines: string[] } | null {
  const lines = tagLines(area, state)
  if (!lines.length) return null
  const anchor = centroid(area.polygon)
  const offset = area.labelOffset ?? { x: 0, y: 0 }
  const center = viewportPt(viewport, { x: anchor.x + offset.x, y: anchor.y + offset.y })
  ctx.font = `${TAG.weight} ${TAG.font}px ${REPORT_FONT_FAMILY}`
  const { width, height } = tagBoxSize(lines.map((line) => ctx.measureText(line).width))
  return { x: center.x - width / 2, y: center.y - height / 2, w: width, h: height, lines }
}

function measureLegend(
  ctx: CanvasRenderingContext2D,
  names: string[],
  orientation: LegendOrientation,
  k: number
): LegendGeometry {
  ctx.font = `${LEGEND.font * k}px ${REPORT_FONT_FAMILY}`
  return legendGeometry(
    names.map((name) => ctx.measureText(name).width),
    orientation,
    k
  )
}

// Page size in PDF points (bottom-left origin) from the viewport's viewBox.
function pageSizePdf(viewport: PageViewport): { width: number; height: number } {
  const [x0, y0, x1, y1] = viewport.viewBox
  return { width: x1 - x0, height: y1 - y0 }
}

// Default legend top-left in PDF points — a fixed inset from the page top-left,
// matching the exported PDF (independent of the current on-screen zoom).
export function defaultLegendPos(viewport: PageViewport): Pt {
  return defaultLegendTopLeft(pageSizePdf(viewport).height)
}

function formatLiveArea(pt2: number, mmPerPt: number | null): string {
  if (mmPerPt == null) return `${pt2.toFixed(1)} pt²`
  return `${((pt2 * mmPerPt * mmPerPt) / 1_000_000).toFixed(2)} m²`
}

export function shouldPanPointer(button: number, tool: Tool): boolean {
  return button === 1 || (button === 0 && tool === 'pan')
}

// A double-click's two pointerdowns add 2 draft points in draw mode; ≤2 means
// the draft was empty before the gesture (0 = edit/pan tools), so treat the
// double-click as select-and-edit. ≥3 means the user is closing a polygon.
export function doubleClickAction(draftLength: number): 'selectArea' | 'closeDraft' {
  return draftLength <= 2 ? 'selectArea' : 'closeDraft'
}

export function anchoredZoomScroll(input: AnchoredZoomInput): Pt {
  return {
    x: ((input.scrollLeft + input.localX) / input.zoom) * input.nextZoom - input.localX,
    y: ((input.scrollTop + input.localY) / input.zoom) * input.nextZoom - input.localY
  }
}

export function constrainDelta(delta: Pt, lockAxis: boolean): Pt {
  if (!lockAxis) return delta
  return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y }
}


export function PdfStage({
  calibrationDraft,
  onCalibrationPoint,
  onToast,
  loading,
  onOpenPdf,
  holeTarget,
  onHoleComplete
}: PdfStageProps): React.JSX.Element {
  const t = useT()
  const pageCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pdfDoc = useAreaStore((s) => s.pdfDoc)
  const activePageIndex = useAreaStore((s) => s.activePageIndex)
  const pages = useAreaStore((s) => s.pages)
  const areas = useAreaStore((s) => s.areas)
  const activeName = useAreaStore((s) => s.activeName)
  const selectedAreaId = useAreaStore((s) => s.selectedAreaId)
  const tool = useAreaStore((s) => s.tool)
  const zoom = useAreaStore((s) => s.zoom)
  const pan = useAreaStore((s) => s.pan)
  const calibrating = useAreaStore((s) => s.calibrating)
  const drawKind = useAreaStore((s) => s.drawKind)
  const legendVisible = useAreaStore((s) => s.legendVisible)
  const tagsVisible = useAreaStore((s) => s.tagsVisible)
  const legendScale = useAreaStore((s) => s.legendScale)
  const legendOrientation = useAreaStore((s) => s.legendOrientation)
  const legendPos = useAreaStore((s) => s.legendPos)
  const setLegendPos = useAreaStore((s) => s.setLegendPos)
  const state = useAreaStore((s) => s)
  const addArea = useAreaStore((s) => s.addArea)
  const selectArea = useAreaStore((s) => s.selectArea)
  const setTool = useAreaStore((s) => s.setTool)
  const setPan = useAreaStore((s) => s.setPan)
  const setZoom = useAreaStore((s) => s.setZoom)
  const moveVertex = useAreaStore((s) => s.moveVertex)
  const setAreaLabelOffset = useAreaStore((s) => s.setAreaLabelOffset)
  const insertVertex = useAreaStore((s) => s.insertVertex)
  const removeVertex = useAreaStore((s) => s.removeVertex)
  const setAreaGeometry = useAreaStore((s) => s.setAreaGeometry)
  const addHole = useAreaStore((s) => s.addHole)
  const beginInteraction = useAreaStore((s) => s.beginInteraction)
  const endInteraction = useAreaStore((s) => s.endInteraction)
  const detailEditing = useAreaStore((s) => s.detailEditing)
  const detailPages = useAreaStore((s) => s.detailPages)
  const removeDetailImage = useAreaStore((s) => s.removeDetailImage)
  const closeDetailEditor = useAreaStore((s) => s.closeDetailEditor)
  const setDetailImage = useAreaStore((s) => s.setDetailImage)
  const setDetailTransform = useAreaStore((s) => s.setDetailTransform)
  const setDetailSummaryPosition = useAreaStore((s) => s.setDetailSummaryPosition)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [draft, setDraft] = useState<Pt[]>([])
  const [hoverPt, setHoverPt] = useState<Pt | null>(null)
  const [selectedVertex, setSelectedVertex] = useState<{ areaId: string; index: number } | null>(
    null
  )
  const [drag, setDrag] = useState<DragState | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const summaryDragRef = useRef<{ pointerId: number } | null>(null)
  const [summaryDomPx, setSummaryDomPx] = useState({ w: 0, h: 0 })
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map())
  const imageErrors = useRef<Set<string>>(new Set())
  const [imageEpoch, setImageEpoch] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wheelBatch = useRef<number | null>(null)
  const flushWheelBatch = useCallback((): void => {
    if (wheelBatch.current == null) return
    window.clearTimeout(wheelBatch.current)
    wheelBatch.current = null
    endInteraction()
  }, [endInteraction])
  const page = pages[activePageIndex]
  const sourceIndex = page ? page.pageIndex : 0
  const pageAreas = useMemo(
    () => areas.filter((area) => area.pageIndex === sourceIndex),
    [sourceIndex, areas]
  )
  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? null

  const currentDetail =
    detailPages.find(
      (dp) =>
        detailEditing != null &&
        dp.name === detailEditing.name &&
        dp.pageIndex === detailEditing.pageIndex
    ) ?? null

  const detailBBox = useMemo(() => {
    if (!detailEditing) return null
    return facilityDetailBBox(areas, detailEditing.name, detailEditing.pageIndex)
  }, [areas, detailEditing])

  const summaryMetrics = useMemo(() => {
    if (!detailEditing) return null
    return detailSummaryMetrics(
      { areas, pages },
      detailEditing.name,
      detailEditing.pageIndex
    )
  }, [areas, pages, detailEditing])

  const rawSummaryPosition = useMemo(() => {
    if (!detailBBox) return null
    return currentDetail?.summaryPosition ?? defaultDetailSummaryPosition(detailBBox)
  }, [currentDetail?.summaryPosition, detailBBox])

  const summaryRenderInput = useMemo(() => {
    if (!summaryMetrics) return null
    return {
      name: summaryMetrics.name,
      level: summaryMetrics.level,
      area:
        summaryMetrics.areaM2 == null
          ? t('detail.notCalibrated')
          : `${summaryMetrics.areaM2.toFixed(2)} m²`,
      stores: String(summaryMetrics.stores),
      labels: {
        floor: t('detail.summaryFloor'),
        area: t('detail.summaryArea'),
        stores: t('detail.summaryStores')
      }
    }
  }, [summaryMetrics, t])

  const summaryOutputSize = useMemo(() => {
    if (!summaryRenderInput) return null
    try {
      return measureDetailSummarySize(summaryRenderInput)
    } catch {
      return null
    }
  }, [summaryRenderInput])

  // Persist/export path: shared unrotated footprint from measured output size.
  const persistedSummaryPosition = useMemo(() => {
    if (!rawSummaryPosition || !detailBBox || !summaryOutputSize) return rawSummaryPosition
    return resolveDetailSummaryPosition(rawSummaryPosition, detailBBox, summaryOutputSize)
  }, [detailBBox, rawSummaryPosition, summaryOutputSize])

  // Render-time only: keep the screen-aligned CSS card inside padded bounds on
  // rotated viewports using the live DOM card size (not the PNG layout size).
  // Does not change the persisted value.
  const displaySummaryPosition = useMemo(() => {
    if (
      !persistedSummaryPosition ||
      !detailBBox ||
      !viewport ||
      summaryDomPx.w <= 0 ||
      summaryDomPx.h <= 0
    ) {
      return persistedSummaryPosition
    }
    const offsets = summarySourceOffsetsFromCss(
      summaryDomPx.w,
      summaryDomPx.h,
      zoom,
      viewport.transform as ViewportTransform
    )
    return clampDetailSummaryAnchor(
      persistedSummaryPosition,
      paddedDetailBounds(detailBBox),
      offsets
    )
  }, [detailBBox, persistedSummaryPosition, summaryDomPx.h, summaryDomPx.w, viewport, zoom])

  useLayoutEffect(() => {
    const el = summaryRef.current
    if (!el || !detailEditing || !summaryMetrics) {
      setSummaryDomPx((prev) => (prev.w === 0 && prev.h === 0 ? prev : { w: 0, h: 0 }))
      return
    }
    const next = { w: el.offsetWidth, h: el.offsetHeight }
    setSummaryDomPx((prev) => (prev.w === next.w && prev.h === next.h ? prev : next))
  }, [detailEditing, displaySummaryPosition, summaryMetrics, summaryRenderInput, zoom])

  const summaryCssPosition = useMemo(() => {
    if (!displaySummaryPosition || !viewport) return null
    const [vx, vy] = viewport.convertToViewportPoint(
      displaySummaryPosition.x,
      displaySummaryPosition.y
    )
    // Stage CSS size is viewport*zoom; canvases fill 100%, so CSS = viewport * zoom.
    return { x: vx * zoom, y: vy * zoom }
  }, [displaySummaryPosition, viewport, zoom])

  // HTMLImageElement decoded from raw base64, cached by the base64 string. Returns the
  // element once decoded (so the draw path can size it); a fresh element triggers one
  // redraw via imageEpoch when it finishes loading.
  const getDetailImage = useCallback(
    (base64: string): HTMLImageElement | null => {
      if (imageErrors.current.has(base64)) return null
      const cache = imageCache.current
      const existing = cache.get(base64)
      if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null
      const img = new Image()
      img.onload = () => setImageEpoch((n) => n + 1)
      img.onerror = () => {
        if (imageErrors.current.has(base64)) return
        imageErrors.current.add(base64)
        onToast(translateNow('toast.detail.imageFailed'))
      }
      img.src = `data:image/png;base64,${base64}`
      cache.set(base64, img)
      return null
    },
    [onToast]
  )

  // Place a freshly imported image centered on the facility bbox, uniformly scaled to
  // fit it, rotation 0. `importImagePng` downscales oversized inputs and returns raw
  // base64 (no data: prefix) so the store snapshot stays sane.
  const placeDetailImage = useCallback(
    async (blob: Blob): Promise<void> => {
      if (!detailEditing) return
      const bbox = facilityDetailBBox(areas, detailEditing.name, detailEditing.pageIndex)
      if (!bbox) return
      const imported = await tryImportDetailImage(blob)
      if (!imported) {
        onToast(translateNow('toast.detail.imageFailed'))
        return
      }
      const { dataBase64, width, height } = imported
      const scale = Math.min(bbox.w / width, bbox.h / height)
      const cx = bbox.x + bbox.w / 2
      const cy = bbox.y + bbox.h / 2
      setDetailImage(detailEditing.name, detailEditing.pageIndex, dataBase64, {
        x: cx - (width * scale) / 2,
        y: cy + (height * scale) / 2,
        scale,
        rotation: 0
      })
    },
    [areas, detailEditing, onToast, setDetailImage]
  )

  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void placeDetailImage(file)
  }

  const closeDraft = useCallback(() => {
    if (draft.length < 3) return
    if (holeTarget) {
      addHole(holeTarget, draft)
      onHoleComplete()
      setDraft([])
      setHoverPt(null)
      return
    }
    if (!activeName) {
      onToast(drawKind === 'store' ? 'Select a facility first' : 'Select or add a facility first')
      return
    }
    if (drawKind === 'store') {
      const code = nextStoreCode(areaStore.getState(), activeName)
      addArea({
        id: crypto.randomUUID(),
        pageIndex: sourceIndex,
        kind: 'store',
        name: activeName,
        code,
        polygon: draft
      })
    } else {
      addArea({
        id: crypto.randomUUID(),
        pageIndex: sourceIndex,
        kind: 'facility',
        name: activeName,
        polygon: draft
      })
    }
    setDraft([])
    setHoverPt(null)
  }, [
    activeName,
    sourceIndex,
    addArea,
    addHole,
    draft,
    drawKind,
    holeTarget,
    onHoleComplete,
    onToast
  ])

  useEffect(() => {
    let cancelled = false
    let renderTask: { promise: Promise<unknown>; cancel: () => void } | null = null
    const canvas = pageCanvasRef.current
    const overlay = overlayRef.current

    if (!pdfDoc || !canvas || !overlay) {
      setViewport(null)
      return
    }

    setViewport(null)
    pdfDoc
      .getPage(sourceIndex + 1)
      .then((pdfPage) => {
        if (cancelled) return
        const nextViewport = pdfPage.getViewport({ scale: 1.5 })
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D context unavailable')

        canvas.width = nextViewport.width
        canvas.height = nextViewport.height
        overlay.width = nextViewport.width
        overlay.height = nextViewport.height
        renderTask = pdfPage.render({ canvasContext: ctx, viewport: nextViewport })
        return renderTask.promise.then(() => {
          if (!cancelled) setViewport(nextViewport)
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) onToast(error instanceof Error ? error.message : 'PDF page render failed')
      })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [sourceIndex, onToast, pdfDoc])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    scroll.scrollLeft = pan.x
    scroll.scrollTop = pan.y
  }, [pan])

  useEffect(() => {
    const canvas = overlayRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !viewport) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const drawPolygon = (area: Area, selected: boolean, drawTag = true): void => {
      if (area.polygon.length < 2) return
      const color = colorForBusiness(state, area.name)
      const pts = area.polygon.map((pt) => viewportPt(viewport, pt))

      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach((pt) => ctx.lineTo(pt.x, pt.y))
      ctx.closePath()
      for (const ring of area.holes ?? []) {
        if (ring.length < 2) continue
        const hpts = ring.map((pt) => viewportPt(viewport, pt))
        ctx.moveTo(hpts[0].x, hpts[0].y)
        hpts.slice(1).forEach((pt) => ctx.lineTo(pt.x, pt.y))
        ctx.closePath()
      }
      ctx.save()
      ctx.globalAlpha = selected ? 0.35 : 0.2
      ctx.fillStyle = color
      ctx.fill('evenodd')
      ctx.restore()
      ctx.strokeStyle = color
      ctx.lineWidth = selected ? 3 : 1.5
      ctx.stroke()

      const rect = drawTag && tagsVisible ? tagRect(area, ctx, viewport, state) : null
      if (rect) {
        ctx.font = `${TAG.weight} ${TAG.font}px ${REPORT_FONT_FAMILY}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#111827'
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
        ctx.strokeStyle = '#ffffff'
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
        ctx.fillStyle = '#ffffff'
        rect.lines.forEach((line, index) =>
          ctx.fillText(
            line,
            rect.x + rect.w / 2,
            rect.y + TAG.padY + TAG.lineH / 2 + index * TAG.lineH
          )
        )
      }
    }

    if (detailEditing) {
      if (currentDetail?.image && currentDetail.transform) {
        const img = getDetailImage(currentDetail.image)
        if (img) {
          const metrics = viewportImageMetrics(
            viewport.transform as ViewportTransform,
            currentDetail.transform.rotation,
            currentDetail.transform.scale
          )
          const cx =
            currentDetail.transform.x + (img.naturalWidth * currentDetail.transform.scale) / 2
          const cy =
            currentDetail.transform.y - (img.naturalHeight * currentDetail.transform.scale) / 2
          const center = viewportPt(viewport, { x: cx, y: cy })
          ctx.save()
          ctx.globalAlpha = DETAIL_IMAGE_OPACITY
          ctx.translate(center.x, center.y)
          ctx.rotate(metrics.angleRad)
          ctx.drawImage(
            img,
            -(img.naturalWidth * metrics.scale) / 2,
            -(img.naturalHeight * metrics.scale) / 2,
            img.naturalWidth * metrics.scale,
            img.naturalHeight * metrics.scale
          )
          ctx.restore()
        }
      }
      areas
        .filter(
          (area) => area.pageIndex === detailEditing.pageIndex && area.name === detailEditing.name
        )
        .forEach((area) => drawPolygon(area, false, shouldDrawDetailTag(area.kind)))
      return
    }

    pageAreas.forEach((area) => drawPolygon(area, area.id === selectedAreaId))

    if (legendVisible) {
      const entries = facilitiesOnPage(state, sourceIndex)
      if (entries.length) {
        const topLeftPdf = legendPos ?? defaultLegendPos(viewport)
        const tl = viewportPt(viewport, topLeftPdf)
        const k = legendScale * viewport.scale
        const geo = measureLegend(
          ctx,
          entries.map((e) => e.name),
          legendOrientation,
          k
        )
        ctx.save()
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.strokeStyle = '#9ca3af'
        ctx.lineWidth = 1
        ctx.fillRect(tl.x, tl.y, geo.width, geo.height)
        ctx.strokeRect(tl.x, tl.y, geo.width, geo.height)
        ctx.font = `${LEGEND.font * k}px ${REPORT_FONT_FAMILY}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        entries.forEach((entry, i) => {
          const slot = geo.slots[i]
          ctx.fillStyle = entry.color
          ctx.fillRect(
            tl.x + slot.swatchX,
            tl.y + slot.swatchY,
            LEGEND.swatch * k,
            LEGEND.swatch * k
          )
          ctx.fillStyle = '#111827'
          ctx.fillText(entry.name, tl.x + slot.textX, tl.y + slot.textY)
        })
        ctx.restore()
      }
    }

    if (draft.length) {
      const pts = [...draft, ...(hoverPt ? [hoverPt] : [])].map((pt) => viewportPt(viewport, pt))
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach((pt) => ctx.lineTo(pt.x, pt.y))
      ctx.strokeStyle = holeTarget ? '#dc2626' : '#111827'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 5])
      ctx.stroke()
      ctx.setLineDash([])
      pts.forEach((pt, index) => {
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, index === 0 ? 5 : 4, 0, Math.PI * 2)
        ctx.fillStyle = index === 0 ? '#16a34a' : '#111827'
        ctx.fill()
      })
    }

    if (calibrating && calibrationDraft.length) {
      const pts = [...calibrationDraft, ...(hoverPt ? [hoverPt] : [])].map((pt) =>
        viewportPt(viewport, pt)
      )
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach((pt) => ctx.lineTo(pt.x, pt.y))
      ctx.strokeStyle = '#dc2626'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    if (tool === 'edit' && selectedArea) {
      const color = colorForBusiness(state, selectedArea.name)
      const pts = selectedArea.polygon.map((pt) => viewportPt(viewport, pt))
      ctx.lineWidth = 2
      pts.forEach((pt, index) => {
        const isSelected =
          selectedVertex?.areaId === selectedArea.id && selectedVertex.index === index
        ctx.fillStyle = isSelected ? color : '#ffffff'
        ctx.strokeStyle = color
        ctx.fillRect(pt.x - 4, pt.y - 4, 8, 8)
        ctx.strokeRect(pt.x - 4, pt.y - 4, 8, 8)
      })
      ctx.font = `${TAG.weight} ${TAG.font}px ${REPORT_FONT_FAMILY}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      pts.forEach((pt, index) => {
        const next = pts[(index + 1) % pts.length]
        const mid = { x: (pt.x + next.x) / 2, y: (pt.y + next.y) / 2 }
        ctx.fillStyle = `${color}55`
        ctx.fillRect(mid.x - 3.5, mid.y - 3.5, 7, 7)
        ctx.fillStyle = '#ffffff'
        ctx.fillText('+', mid.x, mid.y + 0.5)
      })
    }
  }, [
    sourceIndex,
    areas,
    currentDetail,
    detailEditing,
    getDetailImage,
    imageEpoch,
    calibrating,
    calibrationDraft,
    draft,
    hoverPt,
    holeTarget,
    legendPos,
    legendVisible,
    legendOrientation,
    legendScale,
    pageAreas,
    selectedArea,
    selectedAreaId,
    selectedVertex,
    state,
    tagsVisible,
    tool,
    viewport
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Detail mode handles keys via its dedicated Escape listener; skip global handling.
      if (detailEditing) return
      const target = event.target
      const editingText =
        target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
      if (editingText && event.key !== 'Escape') return

      if (draft.length) {
        if (event.key === 'Backspace') {
          event.preventDefault()
          setDraft((current) => current.slice(0, -1))
        } else if (event.key === 'Enter') {
          event.preventDefault()
          closeDraft()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setDraft([])
          setHoverPt(null)
        }
        return
      }

      if (tool === 'edit' && selectedVertex) {
        if (event.key === 'Backspace') {
          event.preventDefault()
          const removed = removeVertex(selectedVertex.areaId, selectedVertex.index)
          if (!removed) onToast('An area needs at least 3 vertices')
          else setSelectedVertex(null)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setSelectedVertex(null)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDraft, detailEditing, draft.length, onToast, removeVertex, selectedVertex, tool])

  useEffect(() => {
    if (!detailEditing) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDetailEditor()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDetailEditor, detailEditing])

  useEffect(() => {
    if (!detailEditing) return
    const onPaste = (event: ClipboardEvent): void => {
      const items = event.clipboardData?.items
      const imageItem = items
        ? Array.from(items).find((item) => item.type.startsWith('image/'))
        : undefined
      const blob = imageItem?.getAsFile()
      if (!blob) {
        onToast(translateNow('toast.detail.notImage'))
        return
      }
      event.preventDefault()
      flushWheelBatch()
      void placeDetailImage(blob)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [detailEditing, flushWheelBatch, onToast, placeDetailImage])

  // A wheel batch only opens in detail mode; flush it when detail mode exits or the
  // component unmounts so its undo entry can't merge with the next interaction.
  useEffect(() => {
    if (!detailEditing) return
    return () => flushWheelBatch()
  }, [detailEditing, flushWheelBatch])

  const detailCamera = useRef<{ key: string; viewport: PageViewport } | null>(null)

  useEffect(() => {
    const scroll = scrollRef.current
    if (detailEditing && viewport && scroll) {
      const key = `${detailEditing.name}\u0000${detailEditing.pageIndex}`
      const prior = detailCamera.current
      if (prior?.key === key && prior.viewport === viewport) return
      const bbox = facilityDetailBBox(areas, detailEditing.name, detailEditing.pageIndex)
      if (!bbox) return
      detailCamera.current = { key, viewport }
      const padded = {
        x: bbox.x - bbox.w * 0.05,
        y: bbox.y - bbox.h * 0.05,
        w: bbox.w * 1.1,
        h: bbox.h * 1.1
      }
      const rect = mappedViewportRect(padded, viewport.transform as ViewportTransform)
      const framed = detailFrame({
        rectX: rect.x,
        rectY: rect.y,
        rectW: rect.w,
        rectH: rect.h,
        containerW: scroll.clientWidth,
        containerH: scroll.clientHeight,
        margin: STAGE_MARGIN
      })
      setZoom(framed.zoom)
      setPan(framed.pan)
    } else if (!detailEditing) {
      detailCamera.current = null
    }
  }, [areas, detailEditing, setPan, setZoom, viewport])

  const findAreaAt = (pt: Pt): Area | null => {
    for (let i = pageAreas.length - 1; i >= 0; i -= 1) {
      if (pointInArea(pageAreas[i], pt)) return pageAreas[i]
    }
    return null
  }

  const findTagAt = (viewportPoint: Pt): Area | null => {
    if (!tagsVisible) return null
    const ctx = overlayRef.current?.getContext('2d')
    if (!ctx || !viewport) return null
    for (let i = pageAreas.length - 1; i >= 0; i -= 1) {
      const area = pageAreas[i]
      if (area.polygon.length < 2) continue
      const rect = tagRect(area, ctx, viewport, state)
      if (
        rect &&
        viewportPoint.x >= rect.x &&
        viewportPoint.x <= rect.x + rect.w &&
        viewportPoint.y >= rect.y &&
        viewportPoint.y <= rect.y + rect.h
      ) {
        return area
      }
    }
    return null
  }

  const findVertexHit = (viewportPoint: Pt): { areaId: string; index: number } | null => {
    if (!viewport || !selectedArea) return null
    const pts = selectedArea.polygon.map((pt) => viewportPt(viewport, pt))
    const index = pts.findIndex((pt) => distance(pt, viewportPoint) <= 9)
    return index === -1 ? null : { areaId: selectedArea.id, index }
  }

  const findMidpointHit = (viewportPoint: Pt): { edgeIndex: number; pt: Pt } | null => {
    if (!viewport || !selectedArea) return null
    const pts = selectedArea.polygon.map((pt) => viewportPt(viewport, pt))
    for (let i = 0; i < pts.length; i += 1) {
      const next = pts[(i + 1) % pts.length]
      const mid = { x: (pts[i].x + next.x) / 2, y: (pts[i].y + next.y) / 2 }
      if (distance(mid, viewportPoint) <= 8) {
        const a = selectedArea.polygon[i]
        const b = selectedArea.polygon[(i + 1) % selectedArea.polygon.length]
        return { edgeIndex: i, pt: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
      }
    }
    return null
  }

  const legendBounds = (): { x: number; y: number; w: number; h: number } | null => {
    if (!viewport || !legendVisible) return null
    const entries = facilitiesOnPage(state, sourceIndex)
    if (!entries.length) return null
    const ctx = overlayRef.current?.getContext('2d')
    if (!ctx) return null
    const tl = viewportPt(viewport, legendPos ?? defaultLegendPos(viewport))
    const geo = measureLegend(
      ctx,
      entries.map((e) => e.name),
      legendOrientation,
      legendScale * viewport.scale
    )
    return { x: tl.x, y: tl.y, w: geo.width, h: geo.height }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!viewport || !overlayRef.current) return
    if (event.button !== 0 && event.button !== 1) return

    const canvas = overlayRef.current
    canvas.setPointerCapture(event.pointerId)
    const startPanDrag = (): void => {
      event.preventDefault()
      const scroll = scrollRef.current
      setDrag({
        kind: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        startPan: { x: scroll?.scrollLeft ?? pan.x, y: scroll?.scrollTop ?? pan.y },
        moved: false
      })
    }

    const pdfPt = eventToPdfPt(event.nativeEvent, canvas, viewport)
    const viewportPoint = eventToViewportPt(event.nativeEvent, canvas)
    if (detailEditing) {
      const transform = currentDetail?.transform
      const img = currentDetail?.image ? getDetailImage(currentDetail.image) : null
      let imageHit = false
      if (img && transform && event.button === 0) {
        const metrics = viewportImageMetrics(
          viewport.transform as ViewportTransform,
          transform.rotation,
          transform.scale
        )
        const cx = transform.x + (img.naturalWidth * transform.scale) / 2
        const cy = transform.y - (img.naturalHeight * transform.scale) / 2
        const center = viewportPt(viewport, { x: cx, y: cy })
        const local = inverseImagePoint(
          viewportPoint,
          center,
          metrics.scale,
          metrics.angleRad,
          img.naturalWidth,
          img.naturalHeight
        )
        imageHit = pointInImageRect(local, img.naturalWidth, img.naturalHeight)
      }
      const summaryEl = summaryRef.current
      const summaryRect = summaryEl?.getBoundingClientRect()
      const summaryHit =
        summaryRect != null &&
        event.clientX >= summaryRect.left &&
        event.clientX <= summaryRect.right &&
        event.clientY >= summaryRect.top &&
        event.clientY <= summaryRect.bottom
      const intent = detailPointerIntent(true, event.button, tool, imageHit, summaryHit)
      if (intent === 'detailSummary') {
        // Summary overlay owns this hit; never start an image drag under it.
        canvas.releasePointerCapture(event.pointerId)
        return
      }
      if (intent === 'detailImage' && transform) {
        flushWheelBatch()
        beginInteraction()
        setDrag({
          kind: 'detailImage',
          startClient: { x: event.clientX, y: event.clientY },
          startPan: pan,
          startPt: pdfPt,
          startTransform: transform,
          moved: false
        })
      } else if (intent === 'pan') {
        startPanDrag()
      }
      return
    }
    if (detailPointerIntent(false, event.button, tool, false, false) === 'pan') {
      startPanDrag()
      return
    }
    if (holeTarget) {
      if (draft.length >= 3) {
        const first = viewportPt(viewport, draft[0])
        if (distance(first, viewportPoint) <= 8) {
          closeDraft()
          return
        }
      }
      setDraft((current) => [...current, pdfPt])
      return
    }

    const bounds = legendBounds()
    if (
      bounds &&
      viewportPoint.x >= bounds.x &&
      viewportPoint.x <= bounds.x + bounds.w &&
      viewportPoint.y >= bounds.y &&
      viewportPoint.y <= bounds.y + bounds.h
    ) {
      flushWheelBatch()
      beginInteraction()
      setDrag({
        kind: 'legend',
        startClient: { x: event.clientX, y: event.clientY },
        startPan: pan,
        startPt: pdfPt,
        startLegendPos: legendPos ?? defaultLegendPos(viewport),
        moved: false
      })
      return
    }

    if (calibrating) {
      onCalibrationPoint(pdfPt)
      return
    }

    if (tool === 'edit') {
      const tagArea = findTagAt(viewportPoint)
      if (tagArea) {
        flushWheelBatch()
        beginInteraction()
        setDrag({
          kind: 'label',
          startClient: { x: event.clientX, y: event.clientY },
          startPan: pan,
          areaId: tagArea.id,
          startPt: pdfPt,
          startLabelOffset: tagArea.labelOffset ?? { x: 0, y: 0 },
          moved: false
        })
        return
      }
      const vertex = findVertexHit(viewportPoint)
      if (vertex) {
        setSelectedVertex(vertex)
        flushWheelBatch()
        beginInteraction()
        setDrag({
          kind: 'vertex',
          startClient: { x: event.clientX, y: event.clientY },
          startPan: pan,
          areaId: vertex.areaId,
          vertexIndex: vertex.index,
          moved: false
        })
        return
      }
      const midpoint = findMidpointHit(viewportPoint)
      if (midpoint && selectedAreaId) {
        insertVertex(selectedAreaId, midpoint.edgeIndex, midpoint.pt)
        return
      }
      const bodyArea = findAreaAt(pdfPt)
      if (bodyArea) {
        if (bodyArea.id !== selectedAreaId) selectArea(bodyArea.id)
        setSelectedVertex(null)
        flushWheelBatch()
        beginInteraction()
        setDrag({
          kind: 'area',
          startClient: { x: event.clientX, y: event.clientY },
          startPan: pan,
          areaId: bodyArea.id,
          startPt: pdfPt,
          startPolygon: bodyArea.polygon.map((pt) => ({ ...pt })),
          startHoles: bodyArea.holes?.map((ring) => ring.map((pt) => ({ ...pt }))),
          moved: false
        })
        return
      }
      if (!selectedAreaId) {
        onToast('Select an area to edit')
        return
      }
      setSelectedVertex(null)
      return
    }

    if (draft.length >= 3 && viewport) {
      const first = viewportPt(viewport, draft[0])
      if (distance(first, viewportPoint) <= 8) {
        closeDraft()
        return
      }
    }

    setDraft((current) => [...current, pdfPt])
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!viewport || !overlayRef.current) return
    const canvas = overlayRef.current
    const pdfPt = eventToPdfPt(event.nativeEvent, canvas, viewport)
    setHoverPt(pdfPt)

    if (!drag) return

    const moved =
      drag.moved || distance(drag.startClient, { x: event.clientX, y: event.clientY }) > 2
    if (drag.kind === 'pan') {
      const scroll = scrollRef.current
      const nextPan = {
        x: drag.startPan.x - (event.clientX - drag.startClient.x),
        y: drag.startPan.y - (event.clientY - drag.startClient.y)
      }
      if (scroll) {
        scroll.scrollLeft = nextPan.x
        scroll.scrollTop = nextPan.y
      }
      setPan(nextPan)
      setDrag({ ...drag, moved })
      return
    }

    if (drag.areaId && drag.vertexIndex != null) {
      if (moved) moveVertex(drag.areaId, drag.vertexIndex, pdfPt)
      setDrag({ ...drag, moved })
    }

    if (drag.kind === 'area' && drag.areaId && drag.startPt && drag.startPolygon) {
      if (moved) {
        const raw = { x: pdfPt.x - drag.startPt.x, y: pdfPt.y - drag.startPt.y }
        const delta = constrainDelta(raw, event.shiftKey)
        setAreaGeometry(
          drag.areaId,
          drag.startPolygon.map((pt) => ({ x: pt.x + delta.x, y: pt.y + delta.y })),
          drag.startHoles?.map((ring) =>
            ring.map((pt) => ({ x: pt.x + delta.x, y: pt.y + delta.y }))
          )
        )
      }
      setDrag({ ...drag, moved })
    }

    if (drag.kind === 'legend' && drag.startPt && drag.startLegendPos) {
      if (moved) {
        const rawPos = {
          x: drag.startLegendPos.x + (pdfPt.x - drag.startPt.x),
          y: drag.startLegendPos.y + (pdfPt.y - drag.startPt.y)
        }
        const ctx = canvas.getContext('2d')
        const entries = facilitiesOnPage(state, sourceIndex)
        if (ctx && entries.length) {
          // Box size is in viewport px; convert to PDF points to clamp against the page.
          const geo = measureLegend(
            ctx,
            entries.map((e) => e.name),
            legendOrientation,
            legendScale * viewport.scale
          )
          const boxW = geo.width / viewport.scale
          const boxH = geo.height / viewport.scale
          const page = pageSizePdf(viewport)
          setLegendPos(clampLegendTopLeft(rawPos, page.width, page.height, boxW, boxH))
        } else {
          setLegendPos(rawPos)
        }
      }
      setDrag({ ...drag, moved })
    }

    if (drag.kind === 'label' && drag.areaId && drag.startPt && drag.startLabelOffset) {
      if (moved) {
        setAreaLabelOffset(drag.areaId, {
          x: drag.startLabelOffset.x + (pdfPt.x - drag.startPt.x),
          y: drag.startLabelOffset.y + (pdfPt.y - drag.startPt.y)
        })
      }
      setDrag({ ...drag, moved })
    }

    if (drag.kind === 'detailImage' && drag.startPt && drag.startTransform && detailEditing) {
      if (moved) {
        setDetailTransform(detailEditing.name, detailEditing.pageIndex, {
          ...drag.startTransform,
          x: drag.startTransform.x + (pdfPt.x - drag.startPt.x),
          y: drag.startTransform.y + (pdfPt.y - drag.startPt.y)
        })
      }
      setDrag({ ...drag, moved })
    }

    if (
      drag.kind === 'detailSummary' &&
      drag.startPt &&
      drag.startPosition &&
      detailEditing &&
      detailBBox
    ) {
      if (drag.pointerId != null && event.pointerId !== drag.pointerId) return
      if (moved && summaryOutputSize) {
        const candidate = summaryPositionAfterDrag(drag.startPosition, drag.startPt, pdfPt)
        const clamped = resolveDetailSummaryPosition(candidate, detailBBox, summaryOutputSize)
        setDetailSummaryPosition(detailEditing.name, detailEditing.pageIndex, clamped)
      }
      setDrag({ ...drag, moved })
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    overlayRef.current?.releasePointerCapture(event.pointerId)
    setDrag(null)
    endInteraction()
  }

  const persistSummaryPosition = (position: Pt): Pt | null => {
    if (!detailBBox || !summaryOutputSize) return null
    return resolveDetailSummaryPosition(position, detailBBox, summaryOutputSize)
  }

  // Idempotent: pointerup/cancel/lostcapture/unmount/detail-exit all share this so
  // Escape mid-drag (overlay unmount) never leaves beginInteraction open.
  const finishSummaryDrag = useCallback((): void => {
    if (summaryDragRef.current == null) return
    summaryDragRef.current = null
    setDrag((current) => (current?.kind === 'detailSummary' ? null : current))
    endInteraction()
  }, [endInteraction])

  useEffect(() => () => finishSummaryDrag(), [finishSummaryDrag])

  // Overlay is conditional on detailEditing; component unmount cleanup alone misses Escape.
  useEffect(() => {
    if (!detailEditing) finishSummaryDrag()
  }, [detailEditing, finishSummaryDrag])

  const onSummaryPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    // Middle-button pan over the card: capture on the overlay so its move/up path runs.
    if (event.button === 1) {
      if (!overlayRef.current) return
      event.preventDefault()
      overlayRef.current.setPointerCapture(event.pointerId)
      const scroll = scrollRef.current
      setDrag({
        kind: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        startPan: { x: scroll?.scrollLeft ?? pan.x, y: scroll?.scrollTop ?? pan.y },
        moved: false
      })
      return
    }
    if (event.button !== 0) return
    if (
      !detailEditing ||
      !viewport ||
      !overlayRef.current ||
      !displaySummaryPosition
    ) {
      return
    }
    if (summaryDragRef.current != null) return
    event.stopPropagation()
    event.preventDefault()
    flushWheelBatch()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    summaryDragRef.current = { pointerId: event.pointerId }
    beginInteraction()
    const startPt = eventToPdfPt(event.nativeEvent, overlayRef.current, viewport)
    setDrag({
      kind: 'detailSummary',
      startClient: { x: event.clientX, y: event.clientY },
      startPan: pan,
      startPt,
      // Start from the rendered anchor so display/persist offset is not a dead-zone.
      startPosition: displaySummaryPosition,
      pointerId: event.pointerId,
      moved: false
    })
  }

  const onSummaryPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag || drag.kind !== 'detailSummary' || !drag.startPt || !drag.startPosition) return
    if (drag.pointerId != null && event.pointerId !== drag.pointerId) return
    if (!detailEditing || !viewport || !overlayRef.current || !detailBBox) return
    const pdfPt = eventToPdfPt(event.nativeEvent, overlayRef.current, viewport)
    const moved =
      drag.moved || distance(drag.startClient, { x: event.clientX, y: event.clientY }) > 2
    if (moved) {
      const candidate = summaryPositionAfterDrag(drag.startPosition, drag.startPt, pdfPt)
      const clamped = persistSummaryPosition(candidate)
      if (clamped) {
        setDetailSummaryPosition(detailEditing.name, detailEditing.pageIndex, clamped)
      }
    }
    setDrag({ ...drag, moved })
  }

  const onSummaryPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = summaryDragRef.current
    if (active != null && event.pointerId !== active.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishSummaryDrag()
  }

  const onSummaryLostPointerCapture = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = summaryDragRef.current
    if (active != null && event.pointerId !== active.pointerId) return
    finishSummaryDrag()
  }

  const onSummaryKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!detailEditing || !detailBBox || !displaySummaryPosition) return
    // Escape must fall through to the window listener that closes detail mode.
    if (event.key === 'Escape') return
    const delta = detailKeyboardDelta(event.key, event.shiftKey)
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    // Step from the displayed anchor; shared footprint clamp persists on movement only.
    const next = persistSummaryPosition({
      x: displaySummaryPosition.x + delta.x,
      y: displaySummaryPosition.y + delta.y
    })
    if (next) {
      setDetailSummaryPosition(detailEditing.name, detailEditing.pageIndex, next)
    }
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!viewport || !overlayRef.current) return
    if (detailEditing) return
    const pdfPt = eventToPdfPt(event.nativeEvent as PointerEvent, overlayRef.current, viewport)
    if (tool === 'edit') {
      const viewportPoint = eventToViewportPt(event.nativeEvent as PointerEvent, overlayRef.current)
      const tagArea = findTagAt(viewportPoint)
      if (tagArea) {
        setAreaLabelOffset(tagArea.id, { x: 0, y: 0 })
        return
      }
    }
    if (doubleClickAction(draft.length) === 'selectArea') {
      setDraft([])
      setHoverPt(null)
      const hitArea = findAreaAt(pdfPt)
      if (hitArea) {
        selectArea(hitArea.id)
        setTool('edit')
      }
      return
    }
    closeDraft()
  }

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    const scroll = scrollRef.current
    if (!scroll) return
    if (detailEditing) {
      event.preventDefault()
      if (!currentDetail?.transform || !viewport || !overlayRef.current) return
      const beginBatch = (): void => {
        beginInteraction()
        if (wheelBatch.current != null) window.clearTimeout(wheelBatch.current)
        wheelBatch.current = window.setTimeout(() => {
          endInteraction()
          wheelBatch.current = null
        }, 400)
      }
      if (event.shiftKey) {
        beginBatch()
        setDetailTransform(detailEditing.name, detailEditing.pageIndex, {
          ...currentDetail.transform,
          rotation: currentDetail.transform.rotation + (event.deltaY < 0 ? 0.5 : -0.5)
        })
        return
      }
      const img = currentDetail.image ? getDetailImage(currentDetail.image) : null
      if (!img) return
      beginBatch()
      const cursor = eventToPdfPt(event.nativeEvent, overlayRef.current, viewport)
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
      setDetailTransform(
        detailEditing.name,
        detailEditing.pageIndex,
        scaleDetailAboutCursor(
          currentDetail.transform,
          img.naturalWidth,
          img.naturalHeight,
          cursor,
          factor
        )
      )
      return
    }
    event.preventDefault()
    const rect = scroll.getBoundingClientRect()
    const current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const nextZoom = Math.min(Math.max(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), 0.2), 8)
    const nextPan = anchoredZoomScroll({
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
      localX: current.x,
      localY: current.y,
      zoom,
      nextZoom
    })
    setZoom(nextZoom)
    requestAnimationFrame(() => setPan(nextPan))
  }

  const livePoly = draft.length && hoverPt ? [...draft, hoverPt] : draft
  const livePt2 = livePoly.length >= 3 ? shoelacePt2(livePoly) : 0
  const liveText = livePt2 ? formatLiveArea(livePt2, mmPerPtFor(state, sourceIndex)) : null

  const guide = holeTarget
    ? t('stage.guide.hole')
    : calibrating
      ? t('stage.guide.calibrate')
      : tool === 'draw'
        ? t('stage.guide.draw')
        : tool === 'edit'
          ? t('stage.guide.edit')
          : t('stage.guide.pan')
  const unscaled = pdfDoc != null && mmPerPtFor(state, sourceIndex) == null

  return (
    <main className="stage-shell">
      {!pdfDoc && !loading ? (
        <div className="empty-state">
          <h1>{t('stage.empty.title')}</h1>
          <p>{t('stage.empty.desc')}</p>
          <button type="button" className="btn btn--primary" onClick={onOpenPdf}>
            {t('stage.empty.open')}
          </button>
          <div className="empty-steps">
            <span>{t('kind.facility')}</span>
            <span>→</span>
            <span>{t('inspector.tab.page')}</span>
            <span>→</span>
            <span>{t('tool.draw')}</span>
            <span>→</span>
            <span>{t('action.generateReport')}</span>
          </div>
        </div>
      ) : null}

      {pdfDoc && !loading ? <div className="stage-guide">{guide}</div> : null}

      <div ref={scrollRef} className="stage-scroll">
        {loading ? (
          <div className="skeleton" aria-hidden="true" />
        ) : (
          <div
            ref={wrapperRef}
            className={detailEditing ? 'pdf-stage is-detail' : 'pdf-stage'}
            style={{
              width: (viewport?.width ?? 0) * zoom,
              height: (viewport?.height ?? 0) * zoom
            }}
          >
            <canvas
              ref={pageCanvasRef}
              className="pdf-canvas"
              style={{ display: detailEditing ? 'none' : 'block' }}
            />
            <canvas
              ref={overlayRef}
              className="overlay-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => setHoverPt(null)}
              onDoubleClick={onDoubleClick}
              onWheel={onWheel}
              onAuxClick={(event) => event.preventDefault()}
            />
            {detailEditing && summaryMetrics && summaryCssPosition ? (
              <div
                ref={summaryRef}
                className={
                  drag?.kind === 'detailSummary' ? 'detail-summary is-dragging' : 'detail-summary'
                }
                role="group"
                tabIndex={0}
                aria-label={t('detail.summaryLabel', {
                  name: summaryMetrics.name,
                  level: summaryMetrics.level
                })}
                style={{
                  left: summaryCssPosition.x,
                  top: summaryCssPosition.y
                }}
                onPointerDown={onSummaryPointerDown}
                onPointerMove={onSummaryPointerMove}
                onPointerUp={onSummaryPointerUp}
                onPointerCancel={onSummaryPointerUp}
                onLostPointerCapture={onSummaryLostPointerCapture}
                onKeyDown={onSummaryKeyDown}
              >
                <div className="detail-summary__heading">
                  <strong>{summaryMetrics.name}</strong>
                  <span>{summaryMetrics.level}</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>{t('detail.summaryFloor')}</th>
                      <th>{t('detail.summaryArea')}</th>
                      <th>{t('detail.summaryStores')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{summaryMetrics.level}</td>
                      <td>
                        {summaryMetrics.areaM2 == null
                          ? t('detail.notCalibrated')
                          : `${summaryMetrics.areaM2.toFixed(2)} m²`}
                      </td>
                      <td>{summaryMetrics.stores}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {pdfDoc && !loading ? (
        <div className="zoom-cluster">
          <button
            type="button"
            className="btn btn--icon"
            aria-label={t('stage.zoomOut')}
            onClick={() => setZoom(zoom / 1.2)}
          >
            −
          </button>
          <span className="value">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="btn btn--icon"
            aria-label={t('stage.zoomIn')}
            onClick={() => setZoom(zoom * 1.2)}
          >
            +
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setZoom(1)
              setPan({ x: 0, y: 0 })
            }}
          >
            {t('stage.zoomFit')}
          </button>
        </div>
      ) : null}

      {detailEditing ? (
        <div className="detail-toolbar">
          <span className="detail-toolbar__hint">{t('detail.hint')}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            style={{ display: 'none' }}
            onChange={onFileChosen}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              flushWheelBatch()
              fileInputRef.current?.click()
            }}
          >
            {t('detail.addImage')}
          </button>
          {currentDetail?.image ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                flushWheelBatch()
                removeDetailImage(detailEditing.name, detailEditing.pageIndex)
              }}
            >
              {t('detail.removeImage')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              flushWheelBatch()
              closeDetailEditor()
            }}
          >
            {t('detail.done')}
          </button>
        </div>
      ) : null}

      <div className="stage-status">
        {loading ? (
          <span>{t('stage.loading')}</span>
        ) : (
          <>
            <span>{page?.label ?? t('page.none')}</span>
            <strong>{t(`tool.${tool}`)}</strong>
            {tool === 'draw' ? <span>{t(`kind.${drawKind}`)}</span> : null}
            {activeName ? <span>{activeName}</span> : null}
            {draft.length ? <span>{t('selection.vertices', { n: draft.length })}</span> : null}
            {unscaled ? <span className="unscaled">{t('stage.status.unscaled')}</span> : null}
            {liveText ? <strong>{liveText}</strong> : null}
          </>
        )}
      </div>
    </main>
  )
}
