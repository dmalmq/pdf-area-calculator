import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { areaNetPt2, areaToM2, polygonCentroid } from '../geometry/area'
import { resolveMmPerPt } from '../geometry/scale'
import { loadPdf } from '../pdf/render'
import { colorForName } from '../utils/colors'
import type {
  AppState,
  Area,
  AreaKind,
  CopiedArea,
  FacilityLevelRow,
  FacilityRow,
  LegendEntry,
  LegendOrientation,
  StoreLabelMode,
  LevelRow,
  PageState,
  ProjectFile,
  Pt,
  ReportRow,
  ScaleMode,
  Tool
} from './types'

export interface AreaStore extends AppState {
  loadDocument(bytes: Uint8Array, name: string): Promise<void>
  setActiveName(name: string | null): void
  addName(name: string): void
  setNameColor(name: string, color: string): void
  setScale(pageIndex: number, mode: ScaleMode): void
  applyScaleToAll(pageIndex: number): void
  addArea(area: Area): void
  deleteArea(id: string): void
  markProjectSaved(): void
  renameArea(id: string, name: string): void
  selectArea(id: string | null): void
  moveVertex(id: string, index: number, pt: Pt): void
  insertVertex(id: string, edgeIndex: number, pt: Pt): void
  removeVertex(id: string, index: number): boolean
  setActivePage(i: number): void
  setTool(t: Tool): void
  setZoom(zoom: number): void
  setPan(pan: Pt): void
  setCalibrating(calibrating: boolean): void
  setPages(pages: PageState[]): void
  importProject(project: {
    pages: PageState[]
    areas: Array<Omit<Area, 'kind'> & { kind?: AreaKind }>
    names: string[]
    colors?: Record<string, string>
    prefixes?: Record<string, string>
    legendPos?: Pt | null
    legendVisible?: boolean
    legendScale?: number
    legendOrientation?: LegendOrientation
    storeLabelMode?: StoreLabelMode
    fileName?: string | null
    pdfPath?: string | null
  }): void
  copySelectedArea(): number
  copyActivePage(): number
  pasteClipboard(): number
  setAreaPolygon(id: string, polygon: Pt[]): void
  setAreaLabelOffset(id: string, offset: Pt): void
  setStoreLabelMode(mode: StoreLabelMode): void
  setDrawKind(kind: AreaKind): void
  setFacilityPrefix(name: string, prefix: string): void
  setStoreCode(id: string, code: string): void
  renumberStores(): number
  setLegendPos(pos: Pt): void
  setLegendVisible(visible: boolean): void
  setLegendScale(scale: number): void
  setLegendOrientation(orientation: LegendOrientation): void
  setAreaKind(id: string, kind: AreaKind): void
  addHole(id: string, ring: Pt[]): void
  removeHole(id: string, holeIndex: number): void
  setAreaGeometry(id: string, polygon: Pt[], holes?: Pt[][]): void
  undo(): void
  redo(): void
  beginInteraction(): void
  endInteraction(): void
  setTagsVisible(visible: boolean): void
}

const initialState: AppState = {
  pdfDoc: null,
  fileName: null,
  pdfPath: null,
  originalBytes: null,
  pages: [],
  areas: [],
  names: [],
  colors: {},
  activeName: null,
  activePageIndex: 0,
  tool: 'draw',
  selectedAreaId: null,
  calibrating: false,
  zoom: 1,
  pan: { x: 0, y: 0 },
  tagsVisible: true,
  clipboard: [],
  drawKind: 'facility',
  prefixes: {},
  legendPos: null,
  legendVisible: true,
  legendScale: 1,
  legendOrientation: 'vertical',
  storeLabelMode: 'code',
  savedFingerprint: null,
  undoStack: [],
  redoStack: []
}

function withName(names: string[], raw: string): string[] {
  const name = raw.trim()
  if (!name || names.includes(name)) return names
  return [...names, name]
}

const colorPattern = /^#[0-9a-f]{6}$/i

function cleanColor(color: string | undefined): string | null {
  const value = color?.trim() ?? ''
  return colorPattern.test(value) ? value.toLowerCase() : null
}

function clampLegendScale(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0.5), 4) : 1
}

function withNameColor(colors: Record<string, string>, raw: string): Record<string, string> {
  const name = raw.trim()
  if (!name || colors[name]) return colors
  return { ...colors, [name]: colorForName(name) }
}

function clonePolygon(polygon: Pt[]): Pt[] {
  return polygon.map((pt) => ({ ...pt }))
}

function cloneHoles(holes?: Pt[][]): Pt[][] | undefined {
  return holes?.map((ring) => ring.map((pt) => ({ ...pt })))
}

function projectColors(
  names: string[],
  colors: Record<string, string> | undefined
): Record<string, string> {
  return names.reduce<Record<string, string>>((next, name) => {
    const custom = colors?.[name] ? cleanColor(colors[name]) : null
    next[name] = custom ?? colorForName(name)
    return next
  }, {})
}

export function colorForBusiness(state: Pick<AppState, 'colors'>, name: string): string {
  return cleanColor(state.colors[name]) ?? colorForName(name)
}

export function toProjectFile(state: AppState): ProjectFile {
  return {
    version: 2,
    fileName: state.fileName,
    pdfPath: state.pdfPath,
    pages: state.pages,
    areas: state.areas,
    names: state.names,
    colors: state.colors,
    prefixes: state.prefixes,
    legendPos: state.legendPos,
    legendVisible: state.legendVisible,
    legendScale: state.legendScale,
    legendOrientation: state.legendOrientation,
    storeLabelMode: state.storeLabelMode
  }
}

export function selectIsDirty(state: AppState): boolean {
  return (
    state.savedFingerprint !== null &&
    JSON.stringify(toProjectFile(state)) !== state.savedFingerprint
  )
}

export function mmPerPtFor(state: Pick<AppState, 'pages'>, pageIndex: number): number | null {
  return resolveMmPerPt(state.pages.find((p) => p.pageIndex === pageIndex)?.scale ?? null)
}

export function areaM2(state: Pick<AppState, 'pages'>, area: Area): number | null {
  return areaToM2(areaNetPt2(area), mmPerPtFor(state, area.pageIndex))
}

export function aggregate(state: Pick<AppState, 'areas' | 'pages'>): ReportRow[] {
  const rows = new Map<string, ReportRow>()

  for (const area of state.areas) {
    if (area.kind !== 'facility') continue
    const name = area.name.trim()
    if (!name) continue

    const row = rows.get(name) ?? { name, scaledM2: 0, unscaledPt2: 0, count: 0 }
    const pt2 = areaNetPt2(area)
    const scaled = areaToM2(pt2, mmPerPtFor(state, area.pageIndex))

    row.count += 1
    if (scaled == null) row.unscaledPt2 += pt2
    else row.scaledM2 += scaled

    rows.set(name, row)
  }

  return [...rows.values()].sort((a, b) => {
    if (a.scaledM2 === 0 && b.scaledM2 !== 0) return 1
    if (a.scaledM2 !== 0 && b.scaledM2 === 0) return -1
    return b.scaledM2 - a.scaledM2
  })
}

type ReportState = Pick<AppState, 'areas' | 'pages'>

function levelOf(state: ReportState, pageIndex: number): string {
  return state.pages.find((p) => p.pageIndex === pageIndex)?.label ?? `Page ${pageIndex + 1}`
}

function orderedLevels(state: ReportState): string[] {
  const seen: string[] = []
  for (const page of [...state.pages].sort((a, b) => a.pageIndex - b.pageIndex)) {
    if (!seen.includes(page.label)) seen.push(page.label)
  }
  return seen
}

function addFacilityArea(
  target: { areaM2: number; unscaledPt2: number },
  state: ReportState,
  area: Area
): void {
  const pt2 = areaNetPt2(area)
  const m2 = areaToM2(pt2, mmPerPtFor(state, area.pageIndex))
  if (m2 == null) target.unscaledPt2 += pt2
  else target.areaM2 += m2
}

export function reportByLevel(state: ReportState): LevelRow[] {
  const rows = new Map<string, LevelRow>()
  const facilitySets = new Map<string, Set<string>>()
  const ensure = (level: string): LevelRow => {
    let row = rows.get(level)
    if (!row) {
      row = { level, areaM2: 0, unscaledPt2: 0, facilities: 0, stores: 0 }
      rows.set(level, row)
      facilitySets.set(level, new Set())
    }
    return row
  }

  for (const area of state.areas) {
    const level = levelOf(state, area.pageIndex)
    const row = ensure(level)
    if (area.kind === 'store') {
      row.stores += 1
    } else {
      addFacilityArea(row, state, area)
      const name = area.name.trim()
      if (name) facilitySets.get(level)!.add(name)
    }
  }
  for (const [level, set] of facilitySets) ensure(level).facilities = set.size

  const order = orderedLevels(state)
  return [...rows.values()].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level))
}

export function reportByFacility(state: ReportState): FacilityRow[] {
  const rows = new Map<string, FacilityRow & { levelSet: Set<string> }>()
  const ensure = (name: string): FacilityRow & { levelSet: Set<string> } => {
    let row = rows.get(name)
    if (!row) {
      row = { name, areaM2: 0, unscaledPt2: 0, levels: [], stores: 0, levelSet: new Set() }
      rows.set(name, row)
    }
    return row
  }

  for (const area of state.areas) {
    const name = area.name.trim()
    if (!name) continue
    const row = ensure(name)
    row.levelSet.add(levelOf(state, area.pageIndex))
    if (area.kind === 'store') row.stores += 1
    else addFacilityArea(row, state, area)
  }

  const order = orderedLevels(state)
  return [...rows.values()]
    .map(({ levelSet, ...row }) => ({
      ...row,
      levels: [...levelSet].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    }))
    .sort((a, b) => b.areaM2 - a.areaM2)
}

export function reportByFacilityLevel(state: ReportState): FacilityLevelRow[] {
  // Nested map (name → level → row) so free-text names/labels can never
  // collide the way a single `${name} ${level}` string key would.
  const byName = new Map<string, Map<string, FacilityLevelRow>>()
  for (const area of state.areas) {
    const name = area.name.trim()
    if (!name) continue
    const level = levelOf(state, area.pageIndex)
    let levels = byName.get(name)
    if (!levels) {
      levels = new Map()
      byName.set(name, levels)
    }
    let row = levels.get(level)
    if (!row) {
      row = { name, level, areaM2: 0, unscaledPt2: 0, stores: 0 }
      levels.set(level, row)
    }
    if (area.kind === 'store') row.stores += 1
    else addFacilityArea(row, state, area)
  }

  const order = orderedLevels(state)
  const rows: FacilityLevelRow[] = []
  for (const levels of byName.values()) rows.push(...levels.values())
  return rows.sort(
    (a, b) => a.name.localeCompare(b.name) || order.indexOf(a.level) - order.indexOf(b.level)
  )
}

export function facilitiesOnPage(
  state: Pick<AppState, 'areas' | 'names' | 'colors'>,
  pageIndex: number
): LegendEntry[] {
  return state.names
    .filter((name) =>
      state.areas.some((area) => area.pageIndex === pageIndex && area.name.trim() === name)
    )
    .map((name) => ({ name, color: colorForBusiness(state, name) }))
}

export function nextStoreCode(
  state: Pick<AppState, 'areas' | 'prefixes'>,
  facilityName: string
): string {
  const prefix = state.prefixes[facilityName]?.trim() ?? ''
  let max = 0
  for (const area of state.areas) {
    if (area.kind !== 'store' || area.name !== facilityName || !area.code) continue
    // Read the number part, ignoring the prefix and any non-numeric suffix
    // (e.g. an edited "ts002A" counts as ordinal 2).
    const body = prefix && area.code.startsWith(prefix) ? area.code.slice(prefix.length) : area.code
    const match = body.match(/\d+/)
    if (match) max = Math.max(max, Number.parseInt(match[0], 10))
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

interface StoreCodeAssignment {
  id: string
  code: string
}

interface StoreOrderItem {
  store: Area
  center: Pt
  height: number
}

// Stores in reading order for renumbering: grouped by page (floor) ascending,
// then banded into rows top-to-bottom (a row = stores whose centroid Y is within
// half the median store height on that page), left-to-right within each row.
function spatialStoreOrder(stores: Area[]): Area[] {
  const pageIndexes = [...new Set(stores.map((s) => s.pageIndex))].sort((a, b) => a - b)
  const ordered: Area[] = []
  for (const pageIndex of pageIndexes) {
    const items: StoreOrderItem[] = stores
      .filter((s) => s.pageIndex === pageIndex)
      .map((store) => {
        const ys = store.polygon.map((p) => p.y)
        const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
        return { store, center: polygonCentroid(store.polygon), height }
      })
    const heights = items.map((i) => i.height).sort((a, b) => a - b)
    const tolerance = heights.length ? heights[Math.floor(heights.length / 2)] * 0.5 : 0
    items.sort((a, b) => b.center.y - a.center.y)
    const rows: StoreOrderItem[][] = []
    let rowTopY = Infinity
    for (const item of items) {
      if (rows.length === 0 || rowTopY - item.center.y > tolerance) {
        rows.push([item])
        rowTopY = item.center.y
      } else {
        rows[rows.length - 1].push(item)
      }
    }
    for (const row of rows) {
      row.sort((a, b) => a.center.x - b.center.x)
      for (const item of row) ordered.push(item.store)
    }
  }
  return ordered
}

// The prefix to apply when renumbering a facility's stores: the registered prefix
// if set, otherwise the most common leading (non-digit) prefix already on that
// facility's codes — so an unregistered "S本館" is preserved and bare-number
// stragglers are normalized to it. Ties break toward a non-empty prefix.
function facilityPrefix(name: string, stores: Area[], prefixes: Record<string, string>): string {
  const registered = prefixes[name]?.trim()
  if (registered) return registered
  const counts = new Map<string, number>()
  for (const store of stores) {
    const lead = (store.code ?? '').match(/^\D*/)?.[0] ?? ''
    counts.set(lead, (counts.get(lead) ?? 0) + 1)
  }
  let best = ''
  let bestCount = -1
  for (const [prefix, count] of counts) {
    if (count > bestCount || (count === bestCount && best === '' && prefix !== '')) {
      best = prefix
      bestCount = count
    }
  }
  return best
}

// New store codes for every store, renumbered per facility in spatialStoreOrder.
// Each facility keeps its prefix (registered, else inferred from existing codes via
// facilityPrefix) + zero-padded 001, 002, …; an unprefixed facility gets bare numbers.
export function renumberStoreCodes(
  state: Pick<AppState, 'areas' | 'prefixes'>
): StoreCodeAssignment[] {
  const byFacility = new Map<string, Area[]>()
  for (const area of state.areas) {
    if (area.kind !== 'store') continue
    const list = byFacility.get(area.name)
    if (list) list.push(area)
    else byFacility.set(area.name, [area])
  }
  const assignments: StoreCodeAssignment[] = []
  for (const [name, stores] of byFacility) {
    const prefix = facilityPrefix(name, stores, state.prefixes)
    spatialStoreOrder(stores).forEach((store, index) => {
      assignments.push({ id: store.id, code: `${prefix}${String(index + 1).padStart(3, '0')}` })
    })
  }
  return assignments
}

const HISTORY_LIMIT = 50

function restoreFields(json: string): Partial<AppState> {
  const p = JSON.parse(json) as ProjectFile
  return {
    pages: p.pages,
    areas: p.areas as Area[],
    names: p.names,
    colors: p.colors ?? {},
    prefixes: p.prefixes ?? {},
    legendPos: p.legendPos ?? null,
    legendVisible: p.legendVisible ?? true,
    legendScale: clampLegendScale(p.legendScale),
    legendOrientation: p.legendOrientation ?? 'vertical',
    storeLabelMode: p.storeLabelMode ?? 'code'
  }
}

export function createAreaStore(initial?: Partial<AppState>): StoreApi<AreaStore> {
  let suppressHistory = false
  let interactionSnapshot: string | null = null
  const snapshot = (state: AppState): string => JSON.stringify(toProjectFile(state))
  const editChanged = (a: AppState, b: AppState): boolean =>
    a.areas !== b.areas ||
    a.pages !== b.pages ||
    a.names !== b.names ||
    a.colors !== b.colors ||
    a.prefixes !== b.prefixes ||
    a.legendPos !== b.legendPos ||
    a.legendVisible !== b.legendVisible ||
    a.legendScale !== b.legendScale ||
    a.legendOrientation !== b.legendOrientation ||
    a.storeLabelMode !== b.storeLabelMode

  const store = createStore<AreaStore>((set, get) => ({
    ...initialState,
    ...initial,

    async loadDocument(bytes, name) {
      const originalBytes = new Uint8Array(bytes)
      const pdfDoc = await loadPdf(new Uint8Array(bytes))
      const pages = Array.from({ length: pdfDoc.numPages }, (_, i) => ({
        pageIndex: i,
        label: `Page ${i + 1}`,
        scale: null
      }))

      suppressHistory = true
      interactionSnapshot = null
      set({
        pdfDoc,
        fileName: name,
        originalBytes,
        pages,
        areas: [],
        names: [],
        colors: {},
        activeName: null,
        activePageIndex: 0,
        tool: 'draw',
        selectedAreaId: null,
        calibrating: false,
        zoom: 1,
        pan: { x: 0, y: 0 },
        undoStack: [],
        redoStack: []
      })
      set({ savedFingerprint: JSON.stringify(toProjectFile(get())) })
      suppressHistory = false
    },

    setActiveName(raw) {
      const name = raw?.trim() ?? ''
      set((state) => ({
        names: name ? withName(state.names, name) : state.names,
        colors: name ? withNameColor(state.colors, name) : state.colors,
        activeName: name || null
      }))
    },

    addName(raw) {
      const name = raw.trim()
      if (!name) return
      set((state) => ({
        names: withName(state.names, name),
        colors: withNameColor(state.colors, name),
        activeName: name
      }))
    },

    setNameColor(raw, rawColor) {
      const name = raw.trim()
      const color = cleanColor(rawColor)
      if (!name || !color) return
      set((state) => ({
        names: withName(state.names, name),
        colors: { ...state.colors, [name]: color }
      }))
    },

    setScale(pageIndex, mode) {
      set((state) => ({
        pages: state.pages.map((page) =>
          page.pageIndex === pageIndex ? { ...page, scale: mode } : page
        )
      }))
    },

    applyScaleToAll(pageIndex) {
      const scale = get().pages.find((page) => page.pageIndex === pageIndex)?.scale ?? null
      set((state) => ({ pages: state.pages.map((page) => ({ ...page, scale })) }))
    },

    addArea(area) {
      const cleanArea = { ...area, name: area.name.trim() }
      if (!cleanArea.name || cleanArea.polygon.length < 3) return
      set((state) => ({
        areas: [...state.areas, cleanArea],
        names: withName(state.names, cleanArea.name),
        colors: withNameColor(state.colors, cleanArea.name),
        selectedAreaId: cleanArea.id,
        tool: 'draw'
      }))
    },

    deleteArea(id) {
      set((state) => ({
        areas: state.areas.filter((candidate) => candidate.id !== id),
        selectedAreaId: state.selectedAreaId === id ? null : state.selectedAreaId
      }))
    },

    markProjectSaved() {
      set({ savedFingerprint: JSON.stringify(toProjectFile(get())) })
    },

    renameArea(id, raw) {
      const name = raw.trim()
      if (!name) return
      set((state) => ({
        areas: state.areas.map((area) => (area.id === id ? { ...area, name } : area)),
        names: withName(state.names, name),
        colors: withNameColor(state.colors, name)
      }))
    },

    selectArea(id) {
      set({ selectedAreaId: id })
    },

    moveVertex(id, index, pt) {
      set((state) => ({
        areas: state.areas.map((area) => {
          if (area.id !== id || index < 0 || index >= area.polygon.length) return area
          const polygon = area.polygon.map((vertex, i) => (i === index ? pt : vertex))
          return { ...area, polygon }
        })
      }))
    },

    insertVertex(id, edgeIndex, pt) {
      set((state) => ({
        areas: state.areas.map((area) => {
          if (area.id !== id || edgeIndex < 0 || edgeIndex >= area.polygon.length) return area
          const polygon = area.polygon.slice()
          polygon.splice(edgeIndex + 1, 0, pt)
          return { ...area, polygon }
        })
      }))
    },

    removeVertex(id, index) {
      const area = get().areas.find((candidate) => candidate.id === id)
      if (!area || area.polygon.length <= 3 || index < 0 || index >= area.polygon.length)
        return false

      set((state) => ({
        areas: state.areas.map((candidate) => {
          if (candidate.id !== id) return candidate
          return { ...candidate, polygon: candidate.polygon.filter((_, i) => i !== index) }
        })
      }))
      return true
    },

    setActivePage(i) {
      const max = Math.max(0, get().pages.length - 1)
      set({
        activePageIndex: Math.min(Math.max(i, 0), max),
        selectedAreaId: null,
        pan: { x: 0, y: 0 }
      })
    },

    setTool(t) {
      set({ tool: t })
    },

    setZoom(zoom) {
      set({ zoom: Math.min(Math.max(zoom, 0.2), 8) })
    },

    setPan(pan) {
      set({ pan })
    },

    setCalibrating(calibrating) {
      set({ calibrating })
    },

    setPages(pages) {
      set({ pages })
    },

    setTagsVisible(visible) {
      set({ tagsVisible: visible })
    },

    importProject(project) {
      suppressHistory = true
      interactionSnapshot = null
      set((state) => ({
        fileName: project.fileName ?? state.fileName,
        pdfPath: project.pdfPath ?? null,
        pages: project.pages,
        areas: project.areas.map((area) => ({
          id: area.id,
          pageIndex: area.pageIndex,
          kind: area.kind ?? 'facility',
          name: area.name,
          code: area.code,
          polygon: area.polygon,
          holes: cloneHoles(area.holes),
          labelOffset: area.labelOffset
        })),
        names: project.names,
        colors: projectColors(project.names, project.colors),
        prefixes: project.prefixes ?? {},
        legendPos: project.legendPos ?? null,
        legendVisible: project.legendVisible ?? true,
        legendScale: clampLegendScale(project.legendScale),
        legendOrientation: project.legendOrientation ?? 'vertical',
        storeLabelMode: project.storeLabelMode ?? 'code',
        activeName: project.names[0] ?? null,
        selectedAreaId: null,
        activePageIndex: 0,
        tool: 'draw',
        undoStack: [],
        redoStack: []
      }))
      set({ savedFingerprint: JSON.stringify(toProjectFile(get())) })
      suppressHistory = false
    },

    copySelectedArea() {
      const state = get()
      const area = state.areas.find((candidate) => candidate.id === state.selectedAreaId)
      if (!area) return 0
      const copied: CopiedArea = {
        kind: area.kind,
        name: area.name,
        code: area.code,
        polygon: clonePolygon(area.polygon),
        holes: cloneHoles(area.holes)
      }
      set({ clipboard: [copied] })
      return 1
    },

    copyActivePage() {
      const state = get()
      const onPage = state.areas.filter((area) => area.pageIndex === state.activePageIndex)
      if (onPage.length === 0) return 0
      const copied: CopiedArea[] = onPage.map((area) => ({
        kind: area.kind,
        name: area.name,
        code: area.code,
        polygon: clonePolygon(area.polygon),
        holes: cloneHoles(area.holes)
      }))
      set({ clipboard: copied })
      return onPage.length
    },

    pasteClipboard() {
      const state = get()
      if (state.clipboard.length === 0) return 0
      const pageIndex = state.activePageIndex
      const pasted: Area[] = []
      const working = { areas: [...state.areas], prefixes: state.prefixes }
      for (const copied of state.clipboard) {
        const area: Area =
          copied.kind === 'store'
            ? {
                id: crypto.randomUUID(),
                pageIndex,
                kind: 'store',
                name: copied.name,
                code: nextStoreCode(working, copied.name),
                polygon: clonePolygon(copied.polygon),
                holes: cloneHoles(copied.holes)
              }
            : {
                id: crypto.randomUUID(),
                pageIndex,
                kind: 'facility',
                name: copied.name,
                code: copied.code,
                polygon: clonePolygon(copied.polygon),
                holes: cloneHoles(copied.holes)
              }
        pasted.push(area)
        working.areas.push(area)
      }
      let names = state.names
      let colors = state.colors
      for (const area of pasted) {
        names = withName(names, area.name)
        colors = withNameColor(colors, area.name)
      }
      set({
        areas: [...state.areas, ...pasted],
        names,
        colors,
        selectedAreaId: pasted[pasted.length - 1].id
      })
      return pasted.length
    },

    setAreaPolygon(id, polygon) {
      set((state) => ({
        areas: state.areas.map((area) => (area.id === id ? { ...area, polygon } : area))
      }))
    },
    setAreaGeometry(id, polygon, holes) {
      set((state) => ({
        areas: state.areas.map((area) =>
          area.id === id ? { ...area, polygon, holes: holes ?? area.holes } : area
        )
      }))
    },
    setAreaKind(id, kind) {
      set((state) => {
        const target = state.areas.find((area) => area.id === id)
        if (!target || target.kind === kind) return {}
        const code = kind === 'store' ? nextStoreCode(state, target.name) : undefined
        return {
          areas: state.areas.map((area) => (area.id === id ? { ...area, kind, code } : area))
        }
      })
    },
    addHole(id, ring) {
      if (ring.length < 3) return
      set((state) => ({
        areas: state.areas.map((area) =>
          area.id === id ? { ...area, holes: [...(area.holes ?? []), clonePolygon(ring)] } : area
        )
      }))
    },
    removeHole(id, holeIndex) {
      set((state) => ({
        areas: state.areas.map((area) => {
          if (area.id !== id || !area.holes || holeIndex < 0 || holeIndex >= area.holes.length)
            return area
          const holes = area.holes.filter((_, i) => i !== holeIndex)
          return { ...area, holes: holes.length ? holes : undefined }
        })
      }))
    },
    beginInteraction() {
      interactionSnapshot = snapshot(get())
    },
    endInteraction() {
      if (interactionSnapshot === null) return
      const before = interactionSnapshot
      interactionSnapshot = null
      if (before === snapshot(get())) return
      suppressHistory = true
      set((s) => ({ undoStack: [...s.undoStack, before].slice(-HISTORY_LIMIT), redoStack: [] }))
      suppressHistory = false
    },
    undo() {
      const s = get()
      if (s.undoStack.length === 0) return
      const current = snapshot(s)
      suppressHistory = true
      set({
        ...restoreFields(s.undoStack[s.undoStack.length - 1]),
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, current].slice(-HISTORY_LIMIT)
      })
      set((st) => ({
        selectedAreaId: st.areas.some((a) => a.id === st.selectedAreaId) ? st.selectedAreaId : null
      }))
      suppressHistory = false
    },
    redo() {
      const s = get()
      if (s.redoStack.length === 0) return
      const current = snapshot(s)
      suppressHistory = true
      set({
        ...restoreFields(s.redoStack[s.redoStack.length - 1]),
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, current].slice(-HISTORY_LIMIT)
      })
      set((st) => ({
        selectedAreaId: st.areas.some((a) => a.id === st.selectedAreaId) ? st.selectedAreaId : null
      }))
      suppressHistory = false
    },

    setAreaLabelOffset(id, offset) {
      set((state) => ({
        areas: state.areas.map((area) => (area.id === id ? { ...area, labelOffset: offset } : area))
      }))
    },

    setStoreLabelMode(mode) {
      set({ storeLabelMode: mode })
    },

    setDrawKind(kind) {
      set({ drawKind: kind })
    },

    setFacilityPrefix(name, prefix) {
      const key = name.trim()
      if (!key) return
      set((state) => ({ prefixes: { ...state.prefixes, [key]: prefix.trim() } }))
    },

    setStoreCode(id, code) {
      set((state) => ({
        areas: state.areas.map((area) =>
          area.id === id && area.kind === 'store' ? { ...area, code: code.trim() } : area
        )
      }))
    },

    renumberStores() {
      const state = get()
      const codeById = new Map(renumberStoreCodes(state).map((a) => [a.id, a.code]))
      const changed = state.areas.reduce((count, area) => {
        const code = codeById.get(area.id)
        return code !== undefined && code !== area.code ? count + 1 : count
      }, 0)
      if (changed === 0) return 0
      set((s) => ({
        areas: s.areas.map((area) => {
          const code = codeById.get(area.id)
          return code === undefined ? area : { ...area, code }
        })
      }))
      return changed
    },

    setLegendPos(pos) {
      set({ legendPos: pos })
    },

    setLegendVisible(visible) {
      set({ legendVisible: visible })
    },

    setLegendScale(scale) {
      set({ legendScale: clampLegendScale(scale) })
    },

    setLegendOrientation(orientation) {
      set({ legendOrientation: orientation })
    }
  }))

  store.subscribe((state, prev) => {
    if (suppressHistory || interactionSnapshot !== null) return
    if (!editChanged(prev, state)) return
    suppressHistory = true
    store.setState((s) => ({
      undoStack: [...s.undoStack, snapshot(prev)].slice(-HISTORY_LIMIT),
      redoStack: []
    }))
    suppressHistory = false
  })

  return store
}

export const areaStore = createAreaStore()

export function useAreaStore<T>(selector: (state: AreaStore) => T): T {
  return useStore(areaStore, selector)
}
