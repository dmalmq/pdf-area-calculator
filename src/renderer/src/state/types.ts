import type { PDFDocumentProxy } from 'pdfjs-dist'

export type Pt = { x: number; y: number } // PDF user-space points, bottom-left origin

export type ScaleMode =
  | { kind: 'ratio'; n: number } // 1:n → mmPerPt = (25.4/72) * n
  | { kind: 'calibration'; a: Pt; b: Pt; realMeters: number } // mmPerPt = realMeters*1000 / dist(a,b)
  | { kind: 'custom'; mmPerPt: number }

export type Tool = 'draw' | 'edit' | 'pan'

// App-level UI state for the currently running async I/O action (not persisted).
export type BusyAction = 'open-pdf' | 'open-project' | 'save-project' | 'generate-report'

export interface PageState {
  pageIndex: number // 0-based
  label: string // default `Page ${i+1}`, user-editable (e.g. "1F")
  scale: ScaleMode | null // null = unscaled
}

export type AreaKind = 'facility' | 'store'

export interface Area {
  id: string // crypto.randomUUID()
  pageIndex: number
  kind: AreaKind // 'facility' (measured) | 'store' (counted only)
  name: string // facility: its 施設名; store: the parent facility's 施設名
  code?: string // store only, e.g. "ts001"
  polygon: Pt[] // outer ring, vertices in PDF pt space
  holes?: Pt[][] // interior rings (courtyards); absent/empty = solid
  labelOffset?: Pt // tag position as a delta from the centroid, in PDF points; absent = centroid
}

export interface ReportRow {
  name: string
  scaledM2: number // sum over scaled pages
  unscaledPt2: number // sum over unscaled pages (0 if none)
  count: number // polygon count
}

export interface LevelRow {
  level: string
  areaM2: number
  unscaledPt2: number
  facilities: number
  stores: number
}

export interface FacilityRow {
  name: string
  areaM2: number
  unscaledPt2: number
  levels: string[]
  stores: number
}

export interface FacilityLevelRow {
  name: string
  level: string
  areaM2: number
  unscaledPt2: number
  stores: number
}

export interface LegendEntry {
  name: string
  color: string
}

export type LegendOrientation = 'vertical' | 'horizontal'

export type StoreLabelMode = 'code' | 'number' | 'off'

export interface CopiedArea {
  kind: AreaKind
  name: string
  code?: string
  polygon: Pt[]
  holes?: Pt[][]
}

export interface DetailTransform {
  x: number // image top-left offset in source-page PDF points
  y: number
  scale: number // PDF points per image pixel (uniform)
  rotation: number // degrees, around the image center
}

export interface DetailPage {
  name: string // facility name
  pageIndex: number // source page (level)
  image?: string // PNG, raw base64 (no data: prefix)
  transform?: DetailTransform // absent until an image is placed
  summaryPosition?: Pt // optional top-left of movable summary overlay
}

export interface ProjectFile {
  version: 1 | 2 | 3
  fileName: string | null
  pdfPath?: string | null
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
  detailPages?: DetailPage[]
}

export interface PdfOpenResult {
  path: string
  bytes: Uint8Array
}

export interface AppApi {
  openPdf(): Promise<PdfOpenResult | null>
  openPdfPath(path: string): Promise<PdfOpenResult | null>
  savePdf(bytes: Uint8Array, defaultName: string): Promise<string | null>
  openProject(): Promise<ProjectFile | null>
  saveProject(project: ProjectFile, defaultName: string): Promise<string | null>
}

export interface AppState {
  pdfDoc: PDFDocumentProxy | null
  fileName: string | null
  pdfPath: string | null
  originalBytes: Uint8Array | null
  pages: PageState[]
  areas: Area[]
  names: string[]
  colors: Record<string, string>
  drawKind: AreaKind
  prefixes: Record<string, string>
  legendPos: Pt | null
  legendVisible: boolean
  legendScale: number
  legendOrientation: LegendOrientation
  storeLabelMode: StoreLabelMode
  detailPages: DetailPage[]
  detailEditing: { name: string; pageIndex: number } | null
  savedFingerprint: string | null
  undoStack: string[]
  redoStack: string[]
  tagsVisible: boolean
  clipboard: CopiedArea[]
  activeName: string | null
  activePageIndex: number
  tool: Tool
  selectedAreaId: string | null
  calibrating: boolean
  zoom: number
  pan: Pt
}

declare global {
  interface Window {
    api: AppApi
  }
}
