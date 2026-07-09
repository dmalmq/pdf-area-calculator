import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { areaToM2, shoelacePt2 } from '../geometry/area'
import { resolveMmPerPt } from '../geometry/scale'
import { loadPdf } from '../pdf/render'
import { colorForName } from '../utils/colors'
import type { AppState, Area, AreaKind, CopiedArea, PageState, Pt, ReportRow, ScaleMode, Tool } from './types'

export interface AreaStore extends AppState {
  loadDocument(bytes: Uint8Array, name: string): Promise<void>
  setActiveName(name: string | null): void
  addName(name: string): void
  setNameColor(name: string, color: string): void
  setScale(pageIndex: number, mode: ScaleMode): void
  applyScaleToAll(pageIndex: number): void
  addArea(area: Area): void
  deleteArea(id: string): void
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
    fileName?: string | null
    pdfPath?: string | null
  }): void
  copySelectedArea(): number
  copyActivePage(): number
  pasteClipboard(): number
  setAreaPolygon(id: string, polygon: Pt[]): void
  setDrawKind(kind: AreaKind): void
  setFacilityPrefix(name: string, prefix: string): void
  setStoreCode(id: string, code: string): void
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
  clipboard: [],
  drawKind: 'facility',
  prefixes: {},
  legendPos: null,
  legendVisible: true
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

function withNameColor(colors: Record<string, string>, raw: string): Record<string, string> {
  const name = raw.trim()
  if (!name || colors[name]) return colors
  return { ...colors, [name]: colorForName(name) }
}

function clonePolygon(polygon: Pt[]): Pt[] {
  return polygon.map((pt) => ({ ...pt }))
}

function projectColors(names: string[], colors: Record<string, string> | undefined): Record<string, string> {
  return names.reduce<Record<string, string>>((next, name) => {
    const custom = colors?.[name] ? cleanColor(colors[name]) : null
    next[name] = custom ?? colorForName(name)
    return next
  }, {})
}

export function colorForBusiness(state: Pick<AppState, 'colors'>, name: string): string {
  return cleanColor(state.colors[name]) ?? colorForName(name)
}

export function mmPerPtFor(state: Pick<AppState, 'pages'>, pageIndex: number): number | null {
  return resolveMmPerPt(state.pages.find((p) => p.pageIndex === pageIndex)?.scale ?? null)
}

export function areaM2(state: Pick<AppState, 'pages'>, area: Area): number | null {
  return areaToM2(shoelacePt2(area.polygon), mmPerPtFor(state, area.pageIndex))
}

export function aggregate(state: Pick<AppState, 'areas' | 'pages'>): ReportRow[] {
  const rows = new Map<string, ReportRow>()

  for (const area of state.areas) {
    const name = area.name.trim()
    if (!name) continue

    const row = rows.get(name) ?? { name, scaledM2: 0, unscaledPt2: 0, count: 0 }
    const pt2 = shoelacePt2(area.polygon)
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

export function createAreaStore(initial?: Partial<AppState>): StoreApi<AreaStore> {
  return createStore<AreaStore>((set, get) => ({
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
        pan: { x: 0, y: 0 }
      })
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
      set((state) => ({ names: withName(state.names, name), colors: withNameColor(state.colors, name), activeName: name }))
    },

    setNameColor(raw, rawColor) {
      const name = raw.trim()
      const color = cleanColor(rawColor)
      if (!name || !color) return
      set((state) => ({ names: withName(state.names, name), colors: { ...state.colors, [name]: color } }))
    },

    setScale(pageIndex, mode) {
      set((state) => ({
        pages: state.pages.map((page) => (page.pageIndex === pageIndex ? { ...page, scale: mode } : page))
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
        areas: state.areas.filter((area) => area.id !== id),
        selectedAreaId: state.selectedAreaId === id ? null : state.selectedAreaId
      }))
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
      if (!area || area.polygon.length <= 3 || index < 0 || index >= area.polygon.length) return false

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
      set({ activePageIndex: Math.min(Math.max(i, 0), max), selectedAreaId: null, pan: { x: 0, y: 0 } })
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

    importProject(project) {
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
          polygon: area.polygon
        })),
        names: project.names,
        colors: projectColors(project.names, project.colors),
        prefixes: project.prefixes ?? {},
        legendPos: project.legendPos ?? null,
        legendVisible: project.legendVisible ?? true,
        activeName: project.names[0] ?? null,
        selectedAreaId: null,
        activePageIndex: 0,
        tool: 'draw'
      }))
    },

    copySelectedArea() {
      const state = get()
      const area = state.areas.find((candidate) => candidate.id === state.selectedAreaId)
      if (!area) return 0
      const copied: CopiedArea = { kind: area.kind, name: area.name, code: area.code, polygon: clonePolygon(area.polygon) }
      set({ clipboard: [copied] })
      return 1
    },

    copyActivePage() {
      const state = get()
      const onPage = state.areas.filter((area) => area.pageIndex === state.activePageIndex)
      if (onPage.length === 0) return 0
      const copied: CopiedArea[] = onPage.map((area) => ({ kind: area.kind, name: area.name, code: area.code, polygon: clonePolygon(area.polygon) }))
      set({ clipboard: copied })
      return onPage.length
    },

    pasteClipboard() {
      const state = get()
      if (state.clipboard.length === 0) return 0
      const pageIndex = state.activePageIndex
      const pasted: Area[] = state.clipboard.map((copied) => ({
        id: crypto.randomUUID(),
        pageIndex,
        kind: copied.kind,
        name: copied.name,
        code: copied.code,
        polygon: clonePolygon(copied.polygon)
      }))
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
    }
  }))
}

export const areaStore = createAreaStore()

export function useAreaStore<T>(selector: (state: AreaStore) => T): T {
  return useStore(areaStore, selector)
}
