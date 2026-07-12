import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'

import { pointInArea, shoelacePt2 } from '../geometry/area'
import { facilityDetailBBox } from '../geometry/detailFit'
import { importImagePng } from '../utils/importImage'
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
import { t as translateNow, useT } from '../i18n'

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
  kind: 'pan' | 'vertex' | 'area' | 'legend' | 'label' | 'detailImage'
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

export function eventToPdfPt(
  e: MouseEvent,
  canvas: HTMLCanvasElement,
  viewport: PageViewport
): Pt {
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

// Frame a viewport-px rectangle to fill the scroll container: uniform fit + centering,
// expressed as the store's zoom/pan (scroll offset). Clamped to the stage zoom range.
export function detailFrame(input: {
  rectX: number
  rectY: number
  rectW: number
  rectH: number
  containerW: number
  containerH: number
  margin: number
}): { zoom: number; pan: Pt } {
  const fit = Math.min(input.containerW / input.rectW, input.containerH / input.rectH)
  const zoom = Math.min(Math.max(fit, 0.2), 8)
  return {
    zoom,
    pan: {
      x: input.margin + input.rectX * zoom - (input.containerW - input.rectW * zoom) / 2,
      y: input.margin + input.rectY * zoom - (input.containerH - input.rectH * zoom) / 2
    }
  }
}

// Inverse-transform a viewport-px point into image-local pixels: subtract the image
// center, un-rotate by the transform rotation, divide by the viewport-px-per-image-px
// scale, then recenter to top-left origin. Mirror of the draw transform in the effect.
export function inverseImagePoint(
  pt: Pt,
  center: Pt,
  s: number,
  rotationRad: number,
  imgW: number,
  imgH: number
): Pt {
  const dx = pt.x - center.x
  const dy = pt.y - center.y
  const cos = Math.cos(-rotationRad)
  const sin = Math.sin(-rotationRad)
  return {
    x: (dx * cos - dy * sin) / s + imgW / 2,
    y: (dx * sin + dy * cos) / s + imgH / 2
  }
}

// True when an image-local point (px, top-left origin) lands on the image rectangle.
export function pointInImageRect(local: Pt, imgW: number, imgH: number): boolean {
  return local.x >= 0 && local.x <= imgW && local.y >= 0 && local.y <= imgH
}

// Scale the transform about a cursor PDF point, keeping the cursor's image-local point
// fixed. Uniform scaling commutes with rotation, so the center simply moves toward/away
// from the cursor by the scale ratio; new top-left is derived from the new center.
export function scaleDetailAboutCursor(
  t: DetailTransform,
  imgW: number,
  imgH: number,
  cursor: Pt,
  factor: number
): DetailTransform {
  const nextScale = t.scale * factor
  const cx = t.x + (imgW * t.scale) / 2
  const cy = t.y - (imgH * t.scale) / 2
  const ratio = nextScale / t.scale
  const ncx = cursor.x - (cursor.x - cx) * ratio
  const ncy = cursor.y - (cursor.y - cy) * ratio
  return {
    x: ncx - (imgW * nextScale) / 2,
    y: ncy + (imgH * nextScale) / 2,
    scale: nextScale,
    rotation: t.rotation
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
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [draft, setDraft] = useState<Pt[]>([])
  const [hoverPt, setHoverPt] = useState<Pt | null>(null)
  const [selectedVertex, setSelectedVertex] = useState<{ areaId: string; index: number } | null>(
    null
  )
  const [drag, setDrag] = useState<DragState | null>(null)
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map())
  const [imageEpoch, setImageEpoch] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wheelBatch = useRef<number | null>(null)
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

  // HTMLImageElement decoded from raw base64, cached by the base64 string. Returns the
  // element once decoded (so the draw path can size it); a fresh element triggers one
  // redraw via imageEpoch when it finishes loading.
  const getDetailImage = useCallback((base64: string): HTMLImageElement | null => {
    const cache = imageCache.current
    const existing = cache.get(base64)
    if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null
    const img = new Image()
    img.onload = () => setImageEpoch((n) => n + 1)
    img.src = `data:image/png;base64,${base64}`
    cache.set(base64, img)
    return null
  }, [])

  // Place a freshly imported image centered on the facility bbox, uniformly scaled to
  // fit it, rotation 0. `importImagePng` downscales oversized inputs and returns raw
  // base64 (no data: prefix) so the store snapshot stays sane.
  const placeDetailImage = useCallback(
    async (blob: Blob): Promise<void> => {
      if (!detailEditing) return
      const bbox = facilityDetailBBox(areas, detailEditing.name, detailEditing.pageIndex)
      if (!bbox) return
      const { dataBase64, width, height } = await importImagePng(blob)
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
    [areas, detailEditing, setDetailImage]
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

    const drawPolygon = (area: Area, selected: boolean): void => {
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

      const rect = tagRect(area, ctx, viewport, state)
      if (tagsVisible && rect) {
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
          const s = viewport.scale * currentDetail.transform.scale
          const cx =
            currentDetail.transform.x + (img.naturalWidth * currentDetail.transform.scale) / 2
          const cy =
            currentDetail.transform.y - (img.naturalHeight * currentDetail.transform.scale) / 2
          const center = viewportPt(viewport, { x: cx, y: cy })
          ctx.save()
          ctx.globalAlpha = 0.9
          ctx.translate(center.x, center.y)
          ctx.rotate((currentDetail.transform.rotation * Math.PI) / 180)
          ctx.drawImage(
            img,
            -(img.naturalWidth * s) / 2,
            -(img.naturalHeight * s) / 2,
            img.naturalWidth * s,
            img.naturalHeight * s
          )
          ctx.restore()
        }
      }
      areas
        .filter(
          (area) => area.pageIndex === detailEditing.pageIndex && area.name === detailEditing.name
        )
        .forEach((area) => drawPolygon(area, false))
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
      void placeDetailImage(blob)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [detailEditing, onToast, placeDetailImage])

  const detailCamera = useRef<{
    key: string
    viewport: PageViewport
    prev: { zoom: number; pan: Pt }
  } | null>(null)

  useEffect(() => {
    const scroll = scrollRef.current
    if (detailEditing && viewport && scroll) {
      const key = `${detailEditing.name}\u0000${detailEditing.pageIndex}`
      const prior = detailCamera.current
      if (prior?.key === key && prior.viewport === viewport) return
      const bbox = facilityDetailBBox(areas, detailEditing.name, detailEditing.pageIndex)
      if (!bbox) return
      detailCamera.current = { key, viewport, prev: prior?.prev ?? { zoom, pan } }
      // Pad the union by 5% per side so outermost vertices don't touch the container edges.
      const pad = {
        x: bbox.x - bbox.w * 0.05,
        y: bbox.y - bbox.h * 0.05,
        w: bbox.w * 1.1,
        h: bbox.h * 1.1
      }
      // PDF points are bottom-left origin, viewport px are y-down: the rect's viewport
      // top-left is the PDF point (x, y + h), its bottom-right is (x + w, y).
      const tl = viewportPt(viewport, { x: pad.x, y: pad.y + pad.h })
      const br = viewportPt(viewport, { x: pad.x + pad.w, y: pad.y })
      const framed = detailFrame({
        rectX: tl.x,
        rectY: tl.y,
        rectW: br.x - tl.x,
        rectH: br.y - tl.y,
        containerW: scroll.clientWidth,
        containerH: scroll.clientHeight,
        margin: STAGE_MARGIN
      })
      setZoom(framed.zoom)
      setPan(framed.pan)
    } else if (!detailEditing && detailCamera.current) {
      const { prev } = detailCamera.current
      detailCamera.current = null
      setZoom(prev.zoom)
      setPan(prev.pan)
    }
  }, [areas, detailEditing, pan, setPan, setZoom, viewport, zoom])

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

    if (shouldPanPointer(event.button, tool)) {
      event.preventDefault()
      const scroll = scrollRef.current
      setDrag({
        kind: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        startPan: { x: scroll?.scrollLeft ?? pan.x, y: scroll?.scrollTop ?? pan.y },
        moved: false
      })
      return
    }

    const pdfPt = eventToPdfPt(event.nativeEvent, canvas, viewport)
    const viewportPoint = eventToViewportPt(event.nativeEvent, canvas)
    if (detailEditing) {
      if (currentDetail?.image && currentDetail.transform) {
        const img = getDetailImage(currentDetail.image)
        if (img) {
          const s = viewport.scale * currentDetail.transform.scale
          const cx =
            currentDetail.transform.x + (img.naturalWidth * currentDetail.transform.scale) / 2
          const cy =
            currentDetail.transform.y - (img.naturalHeight * currentDetail.transform.scale) / 2
          const center = viewportPt(viewport, { x: cx, y: cy })
          const local = inverseImagePoint(
            viewportPoint,
            center,
            s,
            (currentDetail.transform.rotation * Math.PI) / 180,
            img.naturalWidth,
            img.naturalHeight
          )
          if (pointInImageRect(local, img.naturalWidth, img.naturalHeight)) {
            beginInteraction()
            setDrag({
              kind: 'detailImage',
              startClient: { x: event.clientX, y: event.clientY },
              startPan: pan,
              startPt: pdfPt,
              startTransform: currentDetail.transform,
              moved: false
            })
            return
          }
        }
      }
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
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    overlayRef.current?.releasePointerCapture(event.pointerId)
    setDrag(null)
    endInteraction()
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
        if (wheelBatch.current == null) beginInteraction()
        else window.clearTimeout(wheelBatch.current)
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
          <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
            {t('detail.addImage')}
          </button>
          {currentDetail?.image ? (
            <button
              type="button"
              className="btn"
              onClick={() => removeDetailImage(detailEditing.name, detailEditing.pageIndex)}
            >
              {t('detail.removeImage')}
            </button>
          ) : null}
          <button type="button" className="btn btn--primary" onClick={closeDetailEditor}>
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
