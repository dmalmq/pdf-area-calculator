import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'

import { pointInPolygon, shoelacePt2 } from '../geometry/area'
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
import type { AppState, Area, LegendOrientation, Pt, Tool } from '../state/types'
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
}

interface DragState {
  kind: 'pan' | 'vertex' | 'area' | 'legend' | 'label'
  startClient: Pt
  startPan: Pt
  areaId?: string
  vertexIndex?: number
  startPt?: Pt
  startPolygon?: Pt[]
  startLegendPos?: Pt
  startLabelOffset?: Pt
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

export function eventToPdfPt(e: PointerEvent, canvas: HTMLCanvasElement, viewport: PageViewport): Pt {
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
function tagLines(area: Area, state: Pick<AppState, 'pages' | 'prefixes' | 'storeLabelMode'>): string[] {
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
  return legendGeometry(names.map((name) => ctx.measureText(name).width), orientation, k)
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

export function PdfStage({ calibrationDraft, onCalibrationPoint, onToast }: PdfStageProps): React.JSX.Element {
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
  const setAreaPolygon = useAreaStore((s) => s.setAreaPolygon)
  const setAreaLabelOffset = useAreaStore((s) => s.setAreaLabelOffset)
  const insertVertex = useAreaStore((s) => s.insertVertex)
  const removeVertex = useAreaStore((s) => s.removeVertex)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [draft, setDraft] = useState<Pt[]>([])
  const [hoverPt, setHoverPt] = useState<Pt | null>(null)
  const [selectedVertex, setSelectedVertex] = useState<{ areaId: string; index: number } | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const page = pages[activePageIndex]
  const pageAreas = useMemo(
    () => areas.filter((area) => area.pageIndex === activePageIndex),
    [activePageIndex, areas]
  )
  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? null

  const closeDraft = useCallback(() => {
    if (draft.length < 3) return
    if (!activeName) {
      onToast(drawKind === 'store' ? 'Select a facility first' : 'Select or add a facility first')
      return
    }
    if (drawKind === 'store') {
      const code = nextStoreCode(areaStore.getState(), activeName)
      addArea({ id: crypto.randomUUID(), pageIndex: activePageIndex, kind: 'store', name: activeName, code, polygon: draft })
    } else {
      addArea({ id: crypto.randomUUID(), pageIndex: activePageIndex, kind: 'facility', name: activeName, polygon: draft })
    }
    setDraft([])
    setHoverPt(null)
  }, [activeName, activePageIndex, addArea, draft, drawKind, onToast])

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
      .getPage(activePageIndex + 1)
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
  }, [activePageIndex, onToast, pdfDoc])

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
      ctx.save()
      ctx.globalAlpha = selected ? 0.35 : 0.2
      ctx.fillStyle = color
      ctx.fill()
      ctx.restore()
      ctx.strokeStyle = color
      ctx.lineWidth = selected ? 3 : 1.5
      ctx.stroke()

      const rect = tagRect(area, ctx, viewport, state)
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
          ctx.fillText(line, rect.x + rect.w / 2, rect.y + TAG.padY + TAG.lineH / 2 + index * TAG.lineH)
        )
      }
    }

    pageAreas.forEach((area) => drawPolygon(area, area.id === selectedAreaId))

    if (legendVisible) {
      const entries = facilitiesOnPage(state, activePageIndex)
      if (entries.length) {
        const topLeftPdf = legendPos ?? defaultLegendPos(viewport)
        const tl = viewportPt(viewport, topLeftPdf)
        const k = legendScale * viewport.scale
        const geo = measureLegend(ctx, entries.map((e) => e.name), legendOrientation, k)
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
          ctx.fillRect(tl.x + slot.swatchX, tl.y + slot.swatchY, LEGEND.swatch * k, LEGEND.swatch * k)
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
      ctx.strokeStyle = '#111827'
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
      const pts = [...calibrationDraft, ...(hoverPt ? [hoverPt] : [])].map((pt) => viewportPt(viewport, pt))
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
        const isSelected = selectedVertex?.areaId === selectedArea.id && selectedVertex.index === index
        ctx.fillStyle = isSelected ? color : '#ffffff'
        ctx.strokeStyle = color
        ctx.fillRect(pt.x - 4, pt.y - 4, 8, 8)
        ctx.strokeRect(pt.x - 4, pt.y - 4, 8, 8)
      })
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
    activePageIndex,
    calibrating,
    calibrationDraft,
    draft,
    hoverPt,
    legendPos,
    legendVisible,
    legendOrientation,
    legendScale,
    pageAreas,
    selectedArea,
    selectedAreaId,
    selectedVertex,
    state,
    tool,
    viewport
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      const editingText = target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
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
  }, [closeDraft, draft.length, onToast, removeVertex, selectedVertex, tool])

  const findAreaAt = (pt: Pt): Area | null => {
    for (let i = pageAreas.length - 1; i >= 0; i -= 1) {
      if (pointInPolygon(pt, pageAreas[i].polygon)) return pageAreas[i]
    }
    return null
  }

  const findTagAt = (viewportPoint: Pt): Area | null => {
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
    const entries = facilitiesOnPage(state, activePageIndex)
    if (!entries.length) return null
    const ctx = overlayRef.current?.getContext('2d')
    if (!ctx) return null
    const tl = viewportPt(viewport, legendPos ?? defaultLegendPos(viewport))
    const geo = measureLegend(ctx, entries.map((e) => e.name), legendOrientation, legendScale * viewport.scale)
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

    const bounds = legendBounds()
    if (
      bounds &&
      viewportPoint.x >= bounds.x &&
      viewportPoint.x <= bounds.x + bounds.w &&
      viewportPoint.y >= bounds.y &&
      viewportPoint.y <= bounds.y + bounds.h
    ) {
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
        setDrag({
          kind: 'area',
          startClient: { x: event.clientX, y: event.clientY },
          startPan: pan,
          areaId: bodyArea.id,
          startPt: pdfPt,
          startPolygon: bodyArea.polygon.map((pt) => ({ ...pt })),
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

    const moved = drag.moved || distance(drag.startClient, { x: event.clientX, y: event.clientY }) > 2
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
        setAreaPolygon(
          drag.areaId,
          drag.startPolygon.map((pt) => ({ x: pt.x + delta.x, y: pt.y + delta.y }))
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
        const entries = facilitiesOnPage(state, activePageIndex)
        if (ctx && entries.length) {
          // Box size is in viewport px; convert to PDF points to clamp against the page.
          const geo = measureLegend(ctx, entries.map((e) => e.name), legendOrientation, legendScale * viewport.scale)
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
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    overlayRef.current?.releasePointerCapture(event.pointerId)
    setDrag(null)
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!viewport || !overlayRef.current) return
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
  const liveText = livePt2 ? formatLiveArea(livePt2, mmPerPtFor(state, activePageIndex)) : null

  return (
    <main className="stage-shell">
      {!pdfDoc ? (
        <div className="empty-state">
          <h1>Open a vector PDF floor plan</h1>
          <p>Trace business footprints, set a page scale, then append an area summary page to the PDF.</p>
        </div>
      ) : null}
      <div ref={scrollRef} className="stage-scroll">
        <div
          ref={wrapperRef}
          className="pdf-stage"
          style={{
            width: (viewport?.width ?? 0) * zoom,
            height: (viewport?.height ?? 0) * zoom
          }}
        >
          <canvas ref={pageCanvasRef} className="pdf-canvas" />
          <canvas
            ref={overlayRef}
            className="overlay-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setHoverPt(null)}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
            onAuxClick={(event) => event.preventDefault()}
          />
        </div>
      </div>
      <div className="stage-status">
        <span>{page?.label ?? 'No page'}</span>
        <span>{calibrating ? 'Calibration: click two points on the plan' : `Tool: ${tool}`}</span>
        {liveText ? <strong>{liveText}</strong> : null}
      </div>
    </main>
  )
}
