# Facilities, Stores & Per-Level Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename "business" to facility (施設名), add a facility/store area hierarchy where stores are counted (not measured) with auto-numbered codes, use page labels as levels, generate a three-section report, and add a movable per-page facility legend baked into the export.

**Architecture:** Extend the zustand store's `Area` with a `kind` ('facility' | 'store') and store-`code`; add facility `prefixes` and legend state. Add pure selectors for store-code generation, three report groupings, and per-page legend membership. Wire drawing (draw-kind toggle + auto-code), sidebar/toolbar UI, a three-section canvas-rendered report, and a draggable legend embedded as a per-page PNG in the export.

**Tech Stack:** Electron + React 19 + TypeScript, zustand (vanilla store), pdf-lib, canvas 2D, Vitest.

## Global Constraints

- Test runner: `npx vitest run <path>` (there is NO `test` npm script).
- Renderer typecheck: `npm run typecheck:web` must stay clean.
- Polygons are PDF points (`Pt = { x, y }`), bottom-left origin; deep-clone on copy/paste.
- Stores are **count-only**: only `kind:'facility'` polygons contribute m². Stores never produce area figures.
- Store parent = the facility's `name` (name-keyed grouping; a store's `name` is its parent facility's 施設名).
- `ProjectFile.version` becomes `2`; loading v1 (or any area without `kind`) defaults `kind:'facility'`, `prefixes:{}`, `legendPos:null`, `legendVisible:true`. Never break v1 loads.
- Legend uses one shared `legendPos` (PDF-point top-left) on all pages.
- Report/legend text with Japanese must be rendered via canvas → PNG (pdf-lib standard fonts lack CJK glyphs).
- Commit at the end of each task (repo is git, branch created at execution time). Stage only files the task changed; never `git add -A`.
- Follow existing patterns (zustand actions, `describe/it` vitest specs, canvas table renderer).

---

## Phase 1 — Data model, migration & store logic

### Task 1: Area `kind` + new state fields (no behavior change)

**Files:**
- Modify: `src/renderer/src/state/types.ts`
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/components/PdfStage.tsx:122-131` (closeDraft)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Produces: `AreaKind`; `Area` with required `kind: AreaKind` and optional `code?: string`; `CopiedArea` with `kind`/`code`; `AppState` fields `drawKind: AreaKind`, `prefixes: Record<string,string>`, `legendPos: Pt | null`, `legendVisible: boolean`.

- [ ] **Step 1: Add types**

In `src/renderer/src/state/types.ts`, replace the `Area` and `CopiedArea` interfaces:

```ts
export type AreaKind = 'facility' | 'store'

export interface Area {
  id: string // crypto.randomUUID()
  pageIndex: number
  kind: AreaKind // 'facility' (measured) | 'store' (counted only)
  name: string // facility: its 施設名; store: the parent facility's 施設名
  code?: string // store only, e.g. "ts001"
  polygon: Pt[] // vertices in PDF pt space
}

export interface CopiedArea {
  kind: AreaKind
  name: string
  code?: string
  polygon: Pt[]
}
```

In the same file, add these fields to `AppState` (after `colors: Record<string, string>`):

```ts
  drawKind: AreaKind
  prefixes: Record<string, string>
  legendPos: Pt | null
  legendVisible: boolean
```

- [ ] **Step 2: Update store initial state and construction sites**

In `src/renderer/src/state/store.ts`, import `AreaKind` in the type import line:

```ts
import type { AppState, Area, AreaKind, CopiedArea, PageState, Pt, ReportRow, ScaleMode, Tool } from './types'
```

Add the new fields to `initialState` (after `clipboard: []` — add a comma):

```ts
  clipboard: [],
  drawKind: 'facility',
  prefixes: {},
  legendPos: null,
  legendVisible: true
```

Update `copySelectedArea`, `copyActivePage`, and `pasteClipboard` to carry `kind`/`code`. Replace the `copied` construction in `copySelectedArea`:

```ts
      const copied: CopiedArea = { kind: area.kind, name: area.name, code: area.code, polygon: clonePolygon(area.polygon) }
```

Replace the `copied` construction in `copyActivePage`:

```ts
      const copied: CopiedArea[] = onPage.map((area) => ({ kind: area.kind, name: area.name, code: area.code, polygon: clonePolygon(area.polygon) }))
```

Replace the `pasted` mapping in `pasteClipboard`:

```ts
      const pasted: Area[] = state.clipboard.map((copied) => ({
        id: crypto.randomUUID(),
        pageIndex,
        kind: copied.kind,
        name: copied.name,
        code: copied.code,
        polygon: clonePolygon(copied.polygon)
      }))
```

- [ ] **Step 3: Update the facility drawing call in PdfStage**

In `src/renderer/src/components/PdfStage.tsx`, in `closeDraft` (line ~128), tag the new area as a facility:

```ts
    addArea({ id: crypto.randomUUID(), pageIndex: activePageIndex, kind: 'facility', name: activeName, polygon: draft })
```

- [ ] **Step 4: Update the test helper and run the suite**

In `src/renderer/src/state/store.spec.ts`, add `kind: 'facility'` to the `square` helper so existing areas remain valid:

```ts
const square = (pageIndex: number, name: string): Area => ({
  id: crypto.randomUUID(),
  pageIndex,
  kind: 'facility',
  name,
  polygon: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ]
})
```

Also update the one existing clipboard assertion that now carries `kind` (in the
"copies the selected area and nothing when no selection" test). Change:

```ts
    expect(store.getState().clipboard).toEqual([{ name: 'A', polygon: a.polygon }])
```

to:

```ts
    expect(store.getState().clipboard).toEqual([{ kind: 'facility', name: 'A', polygon: a.polygon }])
```

(`code: undefined` is ignored by `toEqual`; only `kind` must be added.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run` — Expected: all existing tests PASS (behavior unchanged).
Run: `npm run typecheck:web` — Expected: clean. If any construction site still lacks `kind`, fix it (search for `addArea(` and any `Area` literal).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/types.ts src/renderer/src/state/store.ts src/renderer/src/components/PdfStage.tsx src/renderer/src/state/store.spec.ts
git commit -m "feat: add area kind and facility/store/legend state fields"
```

---

### Task 2: Store-code helpers, facility prefix & draw-kind action

**Files:**
- Modify: `src/renderer/src/state/store.ts` (AreaStore interface + actions + `nextStoreCode`)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Consumes: `AppState.prefixes`, `Area.kind/code` (Task 1).
- Produces:
  - `nextStoreCode(state: Pick<AppState, 'areas' | 'prefixes'>, facilityName: string): string`
  - `setDrawKind(kind: AreaKind): void`
  - `setFacilityPrefix(name: string, prefix: string): void`
  - `setStoreCode(id: string, code: string): void`

- [ ] **Step 1: Declare the interface members**

In `src/renderer/src/state/store.ts`, add to the `AreaStore` interface (after `setAreaPolygon(...)`):

```ts
  setDrawKind(kind: AreaKind): void
  setFacilityPrefix(name: string, prefix: string): void
  setStoreCode(id: string, code: string): void
```

- [ ] **Step 2: Write failing tests**

Add to `src/renderer/src/state/store.spec.ts` inside `describe('area store', ...)`:

```ts
  it('generates the next store code from the facility prefix', () => {
    const store = createAreaStore({ pages, names: ['A'], prefixes: { A: 'ts' }, areas: [] })
    expect(nextStoreCode(store.getState(), 'A')).toBe('ts001')

    store.setState({
      areas: [
        { id: '1', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [] },
        { id: '2', pageIndex: 0, kind: 'store', name: 'A', code: 'ts004', polygon: [] },
        { id: '3', pageIndex: 0, kind: 'store', name: 'A', code: 'ts002A', polygon: [] }
      ]
    })
    // max ordinal is 4 (from ts004); ts002A counts as ordinal 2
    expect(nextStoreCode(store.getState(), 'A')).toBe('ts005')
  })

  it('uses an empty prefix as just the padded number', () => {
    const store = createAreaStore({ pages, names: ['A'], prefixes: {}, areas: [] })
    expect(nextStoreCode(store.getState(), 'A')).toBe('001')
  })

  it('sets facility prefix, store code, and draw kind', () => {
    const area: Area = { id: 's1', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [] }
    const store = createAreaStore({ pages, names: ['A'], areas: [area] })

    store.getState().setFacilityPrefix('A', ' ts ')
    expect(store.getState().prefixes.A).toBe('ts')

    store.getState().setStoreCode('s1', ' ts009 ')
    expect(store.getState().areas[0].code).toBe('ts009')

    store.getState().setDrawKind('store')
    expect(store.getState().drawKind).toBe('store')
  })
```

Add `nextStoreCode` to the import at the top of the spec:

```ts
import { aggregate, colorForBusiness, createAreaStore, nextStoreCode } from './store'
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.spec.ts` — Expected: FAIL (`nextStoreCode`/actions not defined).

- [ ] **Step 4: Implement**

In `src/renderer/src/state/store.ts`, add the exported helper near `colorForBusiness` (module scope, before `createAreaStore`):

```ts
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
```

Add the actions inside `createStore` (after `setAreaPolygon`):

```ts
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
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/renderer/src/state/store.spec.ts` — Expected: PASS.
Run: `npm run typecheck:web` — Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: store-code generation, facility prefix and draw-kind actions"
```

---

### Task 3: Project v2 migration & persistence

**Files:**
- Modify: `src/renderer/src/state/types.ts` (`ProjectFile`)
- Modify: `src/renderer/src/state/store.ts` (`importProject`)
- Modify: `src/renderer/src/App.tsx` (`saveProject`)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Consumes: new state fields (Task 1).
- Produces: `ProjectFile` v2 shape; `importProject` accepts areas without `kind` and defaults facility, `prefixes`/`legendPos`/`legendVisible`.

- [ ] **Step 1: Update ProjectFile type**

In `src/renderer/src/state/types.ts`, replace the `ProjectFile` interface:

```ts
export interface ProjectFile {
  version: 1 | 2
  fileName: string | null
  pdfPath?: string | null
  pages: PageState[]
  areas: Array<Omit<Area, 'kind'> & { kind?: AreaKind }>
  names: string[]
  colors?: Record<string, string>
  prefixes?: Record<string, string>
  legendPos?: Pt | null
  legendVisible?: boolean
}
```

- [ ] **Step 2: Write failing tests**

Add to `src/renderer/src/state/store.spec.ts`:

```ts
  it('migrates a v1 project: areas without kind become facilities, defaults applied', () => {
    const store = createAreaStore({})
    store.getState().importProject({
      fileName: 'p.pdf',
      pages,
      names: ['A'],
      areas: [{ id: 'a1', pageIndex: 0, name: 'A', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }]
    })
    expect(store.getState().areas[0].kind).toBe('facility')
    expect(store.getState().prefixes).toEqual({})
    expect(store.getState().legendPos).toBeNull()
    expect(store.getState().legendVisible).toBe(true)
  })

  it('imports v2 project fields verbatim', () => {
    const store = createAreaStore({})
    store.getState().importProject({
      fileName: 'p.pdf',
      pages,
      names: ['A'],
      areas: [{ id: 's', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [] }],
      prefixes: { A: 'ts' },
      legendPos: { x: 20, y: 800 },
      legendVisible: false
    })
    expect(store.getState().areas[0].kind).toBe('store')
    expect(store.getState().prefixes).toEqual({ A: 'ts' })
    expect(store.getState().legendPos).toEqual({ x: 20, y: 800 })
    expect(store.getState().legendVisible).toBe(false)
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.spec.ts` — Expected: FAIL (kind undefined / prefixes missing).

- [ ] **Step 4: Update importProject**

In `src/renderer/src/state/store.ts`, change the `importProject` signature and body. Replace the whole `importProject(project) { ... }`:

```ts
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
    }
```

Update the `importProject` signature in the `AreaStore` interface to accept the loose fields:

```ts
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
```

- [ ] **Step 5: Update saveProject**

In `src/renderer/src/App.tsx`, update the `project` literal in `saveProject`:

```ts
    const project: ProjectFile = {
      version: 2,
      fileName: state.fileName,
      pdfPath: state.pdfPath,
      pages: state.pages,
      areas: state.areas,
      names: state.names,
      colors: state.colors,
      prefixes: state.prefixes,
      legendPos: state.legendPos,
      legendVisible: state.legendVisible
    }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run` — Expected: PASS (incl. existing project tests, which omit new fields and rely on defaults).
Run: `npm run typecheck:web` — Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/types.ts src/renderer/src/state/store.ts src/renderer/src/App.tsx src/renderer/src/state/store.spec.ts
git commit -m "feat: project v2 migration and persistence for facilities/stores/legend"
```

---

### Task 4: Kind-aware report selectors

**Files:**
- Modify: `src/renderer/src/state/types.ts` (row types)
- Modify: `src/renderer/src/state/store.ts` (selectors)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Produces (all pure, exported from store.ts):
  - `reportByLevel(state): LevelRow[]`
  - `reportByFacility(state): FacilityRow[]`
  - `reportByFacilityLevel(state): FacilityLevelRow[]`
- Row types in types.ts: `LevelRow`, `FacilityRow`, `FacilityLevelRow`.

- [ ] **Step 1: Add row types**

In `src/renderer/src/state/types.ts`, after `ReportRow`:

```ts
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
```

- [ ] **Step 2: Write failing tests**

Add to `src/renderer/src/state/store.spec.ts`. Use a store where page 0 = '1F' (scaled mmPerPt 10) and page 1 = 'B1F' (unscaled), with a multi-floor facility and stores:

```ts
  it('reports by level, facility and facility-level (stores counted, only facilities measured)', () => {
    const store = createAreaStore({
      pages: [
        { pageIndex: 0, label: '1F', scale: { kind: 'custom', mmPerPt: 10 } },
        { pageIndex: 1, label: 'B1F', scale: { kind: 'custom', mmPerPt: 10 } }
      ],
      names: ['Tekute', 'Other'],
      areas: [
        square(0, 'Tekute'), // facility on 1F, 10x10 pt @10mm/pt = 0.01 m²
        square(1, 'Tekute'), // facility on B1F
        square(0, 'Other'), // facility on 1F
        { id: 's1', pageIndex: 0, kind: 'store', name: 'Tekute', code: 'ts001', polygon: [] },
        { id: 's2', pageIndex: 0, kind: 'store', name: 'Tekute', code: 'ts002', polygon: [] },
        { id: 's3', pageIndex: 1, kind: 'store', name: 'Tekute', code: 'ts003', polygon: [] }
      ]
    })

    const byLevel = reportByLevel(store.getState())
    expect(byLevel.map((r) => r.level)).toEqual(['1F', 'B1F']) // page order
    const oneF = byLevel.find((r) => r.level === '1F')!
    expect(oneF.stores).toBe(2)
    expect(oneF.facilities).toBe(2) // Tekute + Other
    expect(oneF.areaM2).toBeCloseTo(0.02) // two facility squares

    const byFac = reportByFacility(store.getState())
    const tekute = byFac.find((r) => r.name === 'Tekute')!
    expect(tekute.stores).toBe(3)
    expect(tekute.levels).toEqual(['1F', 'B1F'])
    expect(tekute.areaM2).toBeCloseTo(0.02)

    const byFacLevel = reportByFacilityLevel(store.getState())
    const tekuteB1 = byFacLevel.find((r) => r.name === 'Tekute' && r.level === 'B1F')!
    expect(tekuteB1.stores).toBe(1)
    expect(tekuteB1.areaM2).toBeCloseTo(0.01)
  })
```

Add the selectors to the spec import:

```ts
import {
  aggregate,
  colorForBusiness,
  createAreaStore,
  nextStoreCode,
  reportByFacility,
  reportByFacilityLevel,
  reportByLevel
} from './store'
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.spec.ts` — Expected: FAIL (selectors not defined).

- [ ] **Step 4: Implement the selectors**

In `src/renderer/src/state/store.ts`, add the row types to the type import:

```ts
import type {
  AppState,
  Area,
  AreaKind,
  CopiedArea,
  FacilityLevelRow,
  FacilityRow,
  LevelRow,
  PageState,
  Pt,
  ReportRow,
  ScaleMode,
  Tool
} from './types'
```

Add these functions after `aggregate`:

```ts
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

function addFacilityArea(target: { areaM2: number; unscaledPt2: number }, state: ReportState, area: Area): void {
  const pt2 = shoelacePt2(area.polygon)
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
  const rows = new Map<string, FacilityLevelRow>()
  for (const area of state.areas) {
    const name = area.name.trim()
    if (!name) continue
    const level = levelOf(state, area.pageIndex)
    const key = `${name} ${level}`
    let row = rows.get(key)
    if (!row) {
      row = { name, level, areaM2: 0, unscaledPt2: 0, stores: 0 }
      rows.set(key, row)
    }
    if (area.kind === 'store') row.stores += 1
    else addFacilityArea(row, state, area)
  }

  const order = orderedLevels(state)
  return [...rows.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || order.indexOf(a.level) - order.indexOf(b.level)
  )
}
```

- [ ] **Step 5: Make `aggregate` facility-only**

Stores must never be measured, and the sidebar summary preview uses `aggregate`.
In `src/renderer/src/state/store.ts`, add a guard at the top of the `for` loop in
`aggregate`, right after `for (const area of state.areas) {`:

```ts
    if (area.kind !== 'facility') continue
```

The existing `aggregate` test uses only facility squares, so it still passes.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/renderer/src/state/store.spec.ts` — Expected: PASS.
Run: `npm run typecheck:web` — Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/types.ts src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: kind-aware report selectors (by level, facility, facility-level)"
```

---

## Phase 2 — Drawing & UI

### Task 5: Draw-kind toggle + store drawing with auto-code

**Files:**
- Modify: `src/renderer/src/components/Toolbar.tsx` (draw-kind toggle)
- Modify: `src/renderer/src/components/PdfStage.tsx` (closeDraft store branch)
- Modify: `src/renderer/src/App.tsx` (keyboard F/S + shortcut rows)

**Interfaces:**
- Consumes: `drawKind`/`setDrawKind`, `nextStoreCode` (Tasks 1–2).

- [ ] **Step 1: Add the draw-kind toggle to the Toolbar**

In `src/renderer/src/components/Toolbar.tsx`, add store selectors near the others:

```ts
  const drawKind = useAreaStore((s) => s.drawKind)
  const setDrawKind = useAreaStore((s) => s.setDrawKind)
```

Add this group immediately after the Tools `toolbar__group` (before the Zoom group):

```tsx
      <div className="toolbar__group" aria-label="Draw kind">
        <button
          type="button"
          className={drawKind === 'facility' ? 'is-active' : ''}
          onClick={() => setDrawKind('facility')}
        >
          施設
        </button>
        <button
          type="button"
          className={drawKind === 'store' ? 'is-active' : ''}
          onClick={() => setDrawKind('store')}
        >
          店舗
        </button>
      </div>
```

- [ ] **Step 2: Wire store drawing in PdfStage.closeDraft**

In `src/renderer/src/components/PdfStage.tsx`, add store selectors near the other `useAreaStore` calls:

```ts
  const drawKind = useAreaStore((s) => s.drawKind)
```

Replace the `closeDraft` callback body:

```ts
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
```

Add `areaStore` and `nextStoreCode` to the store import at the top of PdfStage.tsx:

```ts
import { areaM2, areaStore, colorForBusiness, mmPerPtFor, nextStoreCode, useAreaStore } from '../state/store'
```

- [ ] **Step 3: Keyboard shortcuts + overlay rows**

In `src/renderer/src/App.tsx`, in the `onKeyDown` tool chain, add before the `else if (event.key === '[')` line:

```ts
      else if (event.key === 'F' || event.key === 'f') state.setDrawKind('facility')
      else if (event.key === 'S' || event.key === 's') state.setDrawKind('store')
```

Add rows to `shortcutRows` (before the `Ctrl/Cmd + C` row):

```ts
  ['F / S', 'Draw kind: facility / store'],
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck:web` — Expected: clean.
Run: `npx vitest run` — Expected: all PASS (no test changes; wiring only).
Manual (deferred to controller): with a facility selected, toggle 店舗, draw a polygon → a store with an auto code is created; with no facility selected, drawing a store toasts "Select a facility first".

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Toolbar.tsx src/renderer/src/components/PdfStage.tsx src/renderer/src/App.tsx
git commit -m "feat: draw-kind toggle and store drawing with auto-generated codes"
```

---

### Task 6: Sidebar — 施設名 rename, prefix input, store code editing

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `prefixes`/`setFacilityPrefix`, `setStoreCode`, `Area.kind/code` (Tasks 1–2).

- [ ] **Step 1: Rename the facilities panel and add the prefix input**

In `src/renderer/src/components/Sidebar.tsx`, replace the first `<section className="panel">` block (the "Businesses" panel, lines 26-66) with:

```tsx
      <section className="panel">
        <div className="panel__header">
          <h2>施設名</h2>
          <span>{state.names.length}</span>
        </div>
        <div className="name-entry">
          <input
            ref={inputRef}
            value={name}
            placeholder="エスパル仙台本館"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addBusiness()
            }}
          />
          <button type="button" onClick={addBusiness}>Add</button>
        </div>
        <div className="chip-list">
          {state.names.map((candidate) => {
            const color = colorForBusiness(state, candidate)
            return (
              <div key={candidate} className="chip-row">
                <input
                  type="color"
                  value={color}
                  aria-label={`${candidate} color`}
                  onChange={(event) => state.setNameColor(candidate, event.target.value)}
                />
                <button
                  type="button"
                  className={state.activeName === candidate ? 'chip is-active' : 'chip'}
                  onClick={() => state.setActiveName(candidate)}
                >
                  <span style={{ background: color }} />
                  {candidate}
                </button>
                <input
                  className="prefix-input"
                  value={state.prefixes[candidate] ?? ''}
                  placeholder="ts"
                  aria-label={`${candidate} store code prefix`}
                  onChange={(event) => state.setFacilityPrefix(candidate, event.target.value)}
                />
              </div>
            )
          })}
        </div>
      </section>
```

- [ ] **Step 2: Show kind/code in the area list**

Replace the `formatArea` usage row (the `<small>` line, ~101) so stores show their code and facilities show area. Replace the `<span>` block inside `area-row__main`:

```tsx
                    <span>
                      <strong>{area.kind === 'store' ? area.code || '(no code)' : area.name}</strong>
                      <small>
                        {area.kind === 'store'
                          ? `店舗 · ${area.name}`
                          : formatArea(areaM2(state, area), shoelacePt2(area.polygon))}
                      </small>
                    </span>
```

- [ ] **Step 3: Edit store code in the selected panel**

In the `selected` panel, after the `Business` `<label className="field">` select block, add a store-code editor shown only for stores. Insert before the `Copy area` button:

```tsx
          {selected.kind === 'store' ? (
            <label className="field">
              <span>Store code</span>
              <input
                value={selected.code ?? ''}
                onChange={(event) => state.setStoreCode(selected.id, event.target.value)}
              />
            </label>
          ) : null}
```

Also change the `Business` label text to `施設名`:

```tsx
          <label className="field">
            <span>施設名</span>
```

- [ ] **Step 4: Rename the summary-preview labels (terminology)**

In the `summary-panel` section, change the empty text and the first table header
from "Business" to 施設名, and add a 店舗 (stores) column is out of scope here —
keep the existing columns but relabel. Replace the empty `<p>`:

```tsx
          <p className="empty">Measured facilities will appear here before export.</p>
```

and the first `<th>`:

```tsx
                <th>施設名</th>
```

- [ ] **Step 5: Add prefix-input styling**

Append to `src/renderer/src/assets/main.css`:

```css
.prefix-input {
  width: 56px;
  flex: 0 0 auto;
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck:web` — Expected: clean.
Run: `npx vitest run` — Expected: all PASS.
Manual (deferred): each facility chip has a prefix box; stores in the list show their code and parent; selecting a store shows an editable code field.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/assets/main.css
git commit -m "feat: sidebar facility rename, prefix input and store code editing"
```

---

### Task 7: Canvas store labels + level in toolbar

**Files:**
- Modify: `src/renderer/src/components/PdfStage.tsx` (drawPolygon label)
- Modify: `src/renderer/src/components/Toolbar.tsx` (page indicator shows level)

**Interfaces:**
- Consumes: `Area.kind/code`, `PageState.label`.

- [ ] **Step 1: Store labels on the canvas**

In `src/renderer/src/components/PdfStage.tsx`, in `drawPolygon`, replace the `lines` computation (line ~206):

```ts
      const scaled = areaM2(state, area)
      const lines =
        area.kind === 'store'
          ? [area.code || '—']
          : [area.name, scaled == null ? 'unscaled' : `${scaled.toFixed(2)} m²`]
```

- [ ] **Step 2: Show the level in the Toolbar page indicator**

In `src/renderer/src/components/Toolbar.tsx`, add a selector for the active page label:

```ts
  const pageLabel = useAreaStore((s) => s.pages[s.activePageIndex]?.label ?? '')
```

Replace the page `toolbar__label` span:

```tsx
        <span className="toolbar__label">
          {pageCount ? `${pageLabel} · ` : ''}Page {pageCount ? pageIndex + 1 : 0}/{pageCount}
        </span>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck:web` — Expected: clean.
Run: `npx vitest run` — Expected: all PASS.
Manual (deferred): store polygons show their code; the toolbar shows e.g. `1F · Page 2/5`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/PdfStage.tsx src/renderer/src/components/Toolbar.tsx
git commit -m "feat: store code canvas labels and level in the toolbar page indicator"
```

---

### Task 8: Copy/paste — re-code pasted stores

**Files:**
- Modify: `src/renderer/src/state/store.ts` (`pasteClipboard`)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Consumes: `nextStoreCode` (Task 2), clipboard carry of `kind`/`code` (Task 1).

- [ ] **Step 1: Write failing test**

Add to `src/renderer/src/state/store.spec.ts`:

```ts
  it('re-codes pasted stores and keeps pasted facility names', () => {
    const store = createAreaStore({
      pages,
      names: ['A'],
      prefixes: { A: 'ts' },
      areas: [
        { id: 'f', pageIndex: 0, kind: 'facility', name: 'A', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
        { id: 's', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }
      ]
    })
    // copy the store, paste it — it must get a fresh code, not ts001 again
    store.getState().selectArea('s')
    store.getState().copySelectedArea()
    store.getState().pasteClipboard()
    const codes = store.getState().areas.filter((a) => a.kind === 'store').map((a) => a.code)
    expect(codes).toEqual(['ts001', 'ts002'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.spec.ts` — Expected: FAIL (pasted store keeps `ts001`).

- [ ] **Step 3: Re-code stores during paste**

In `src/renderer/src/state/store.ts`, replace the `pasted` mapping in `pasteClipboard` so store codes advance. Because each new store must count against the ones already added in this same paste, build the array imperatively:

```ts
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
                polygon: clonePolygon(copied.polygon)
              }
            : {
                id: crypto.randomUUID(),
                pageIndex,
                kind: 'facility',
                name: copied.name,
                code: copied.code,
                polygon: clonePolygon(copied.polygon)
              }
        pasted.push(area)
        working.areas.push(area)
      }
```

(The `working` accumulator makes `nextStoreCode` see stores added earlier in the same paste, so multiple pasted stores get sequential codes.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/renderer/src/state/store.spec.ts` — Expected: PASS.
Run: `npm run typecheck:web` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: re-code pasted stores to avoid duplicate codes"
```

---

## Phase 3 — Report

### Task 9: Three-section report renderer

**Files:**
- Create: `src/renderer/src/report/reportImage.ts`
- Create: `src/renderer/src/report/reportImage.spec.ts`
- Delete: `src/renderer/src/report/tableImage.ts`, `src/renderer/src/report/tableImage.spec.ts`
- Modify: `src/renderer/src/App.tsx` (`generateReport`)

**Interfaces:**
- Consumes: `reportByLevel`/`reportByFacility`/`reportByFacilityLevel` (Task 4).
- Produces: `renderReportPng(state, title): Promise<Uint8Array>` where `state: Pick<AppState,'areas'|'pages'>`.

- [ ] **Step 1: Write the renderer smoke test**

Create `src/renderer/src/report/reportImage.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { renderReportPng } from './reportImage'
import type { AppState } from '../state/types'

// jsdom canvas.toBlob is not implemented; stub it to return bytes.
function stubCanvas(): void {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    scale: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), save: vi.fn(), restore: vi.fn(),
    set fillStyle(_v) {}, set strokeStyle(_v) {}, set font(_v) {}, set textAlign(_v) {},
    set textBaseline(_v) {}, set lineWidth(_v) {}
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
  }
}

describe('renderReportPng', () => {
  it('produces a non-empty PNG for a populated state', async () => {
    stubCanvas()
    const state = {
      pages: [{ pageIndex: 0, label: '1F', scale: { kind: 'custom', mmPerPt: 10 } }],
      areas: [
        { id: 'f', pageIndex: 0, kind: 'facility', name: 'A', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
        { id: 's', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [] }
      ]
    } as Pick<AppState, 'areas' | 'pages'>
    const png = await renderReportPng(state, 'Report')
    expect(png.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/report/reportImage.spec.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement the renderer**

Create `src/renderer/src/report/reportImage.ts`:

```ts
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
```

- [ ] **Step 4: Switch generateReport to the new renderer**

In `src/renderer/src/App.tsx`, update the import:

```ts
import { renderReportPng } from './report/reportImage'
```

(remove the `renderTablePng` import). Replace the body of `generateReport` from the `const rows = aggregate(state)` line through the `renderTablePng` call:

```ts
    const state = areaStore.getState()
    if (!state.originalBytes) {
      showToast('Open a PDF before generating a report')
      return
    }
    if (!state.areas.length) return
    const unscaledCount = state.areas.filter(
      (area) => area.kind === 'facility' && mmPerPtFor(state, area.pageIndex) == null
    ).length
    if (unscaledCount > 0) {
      const ok = window.confirm(
        `${unscaledCount} facility polygons are on unscaled pages and will be reported in pt², not m². Continue?`
      )
      if (!ok) return
    }
    const title = `面積集計 — ${state.fileName ?? 'PDF'}`
    const png = await renderReportPng(state, title)
    const pdf = await buildReportPdf(state.originalBytes, png, state.areas, state.colors)
    const defaultName = `${withoutExt(state.fileName ?? 'pdf')}_areas.pdf`
    const saved = await window.api.savePdf(pdf, defaultName)
    if (saved) showToast(`Report saved to ${baseName(saved)}`)
```

Remove the now-unused `aggregate` import from App.tsx if present (it is: `aggregate` is imported from `./state/store` — drop it from that import list).

- [ ] **Step 5: Delete the old table renderer**

```bash
git rm src/renderer/src/report/tableImage.ts src/renderer/src/report/tableImage.spec.ts
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run` — Expected: PASS (reportImage smoke test green, tableImage tests gone).
Run: `npm run typecheck:web` — Expected: clean (no dangling `renderTablePng`/`aggregate` references).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/report/reportImage.ts src/renderer/src/report/reportImage.spec.ts src/renderer/src/App.tsx
git commit -m "feat: three-section report renderer replacing the single table"
```

---

## Phase 4 — Facility legend

### Task 10: Legend state, actions & membership selector

**Files:**
- Modify: `src/renderer/src/state/types.ts` (`LegendEntry`)
- Modify: `src/renderer/src/state/store.ts` (`setLegendPos`, `setLegendVisible`, `facilitiesOnPage`)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Produces: `LegendEntry { name: string; color: string }`; `setLegendPos(pos: Pt): void`; `setLegendVisible(visible: boolean): void`; `facilitiesOnPage(state, pageIndex): LegendEntry[]`.

- [ ] **Step 1: Add the LegendEntry type**

In `src/renderer/src/state/types.ts`, after `FacilityLevelRow`:

```ts
export interface LegendEntry {
  name: string
  color: string
}
```

- [ ] **Step 2: Write failing tests**

Add to `src/renderer/src/state/store.spec.ts`:

```ts
  it('lists facilities on a page (any area) and legend state actions', () => {
    const store = createAreaStore({
      pages,
      names: ['A', 'B'],
      areas: [
        square(0, 'A'), // facility on page 0
        { id: 's', pageIndex: 0, kind: 'store', name: 'B', code: 'b001', polygon: [] } // only a store for B on page 0
      ]
    })
    const entries = facilitiesOnPage(store.getState(), 0)
    expect(entries.map((e) => e.name)).toEqual(['A', 'B'])
    expect(entries[0].color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(facilitiesOnPage(store.getState(), 1)).toEqual([])

    store.getState().setLegendPos({ x: 5, y: 9 })
    expect(store.getState().legendPos).toEqual({ x: 5, y: 9 })
    store.getState().setLegendVisible(false)
    expect(store.getState().legendVisible).toBe(false)
  })
```

Add `facilitiesOnPage` to the spec import from `./store`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.spec.ts` — Expected: FAIL.

- [ ] **Step 4: Implement**

In `src/renderer/src/state/store.ts`, add `LegendEntry` to the type import, then add the selector after `reportByFacilityLevel`:

```ts
export function facilitiesOnPage(
  state: Pick<AppState, 'areas' | 'names' | 'colors'>,
  pageIndex: number
): LegendEntry[] {
  return state.names
    .filter((name) => state.areas.some((area) => area.pageIndex === pageIndex && area.name.trim() === name))
    .map((name) => ({ name, color: colorForBusiness(state, name) }))
}
```

Declare the two actions in the `AreaStore` interface (after `setStoreCode`):

```ts
  setLegendPos(pos: Pt): void
  setLegendVisible(visible: boolean): void
```

Implement them inside `createStore` (after `setStoreCode`):

```ts
    setLegendPos(pos) {
      set({ legendPos: pos })
    },

    setLegendVisible(visible) {
      set({ legendVisible: visible })
    },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/renderer/src/state/store.spec.ts` — Expected: PASS.
Run: `npm run typecheck:web` — Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/types.ts src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: legend state actions and per-page facility membership selector"
```

---

### Task 11: Draggable legend overlay + visibility toggle

**Files:**
- Modify: `src/renderer/src/components/PdfStage.tsx` (draw legend + drag)
- Modify: `src/renderer/src/components/Toolbar.tsx` (legend toggle)

**Interfaces:**
- Consumes: `facilitiesOnPage`, `legendPos`/`legendVisible`, `setLegendPos` (Task 10).

**Legend geometry helper (shared shape):** the legend box top-left is `legendPos` in PDF points (or a default). Rows are `swatch + name`. These constants live in PdfStage:

- [ ] **Step 1: Add a legend layout helper + default position**

In `src/renderer/src/components/PdfStage.tsx`, add near the top-level helpers (after `centroid`):

```ts
const LEGEND = { rowH: 22, padding: 10, swatch: 12, gap: 8, font: 13 }

function legendEntriesWidth(ctx: CanvasRenderingContext2D, names: string[]): number {
  ctx.font = `${LEGEND.font}px "Yu Gothic UI", system-ui, sans-serif`
  const textW = Math.max(0, ...names.map((n) => ctx.measureText(n).width))
  return LEGEND.padding * 2 + LEGEND.swatch + LEGEND.gap + textW
}

// Default legend top-left in PDF points: near the top-left of the page.
export function defaultLegendPos(viewport: PageViewport): Pt {
  const [x, y] = viewport.convertToPdfPoint(24, 24)
  return { x, y }
}
```

- [ ] **Step 2: Draw the legend on the overlay**

In the overlay-drawing `useEffect` (the one that calls `drawPolygon`), after the `pageAreas.forEach((area) => drawPolygon(...))` line and before the `draft` block, add legend rendering. Compute entries from the store selector:

```ts
    if (legendVisible) {
      const entries = facilitiesOnPage(state, activePageIndex)
      if (entries.length) {
        const topLeftPdf = legendPos ?? defaultLegendPos(viewport)
        const tl = viewportPt(viewport, topLeftPdf)
        const boxW = legendEntriesWidth(ctx, entries.map((e) => e.name))
        const boxH = LEGEND.padding * 2 + entries.length * LEGEND.rowH
        ctx.save()
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.strokeStyle = '#9ca3af'
        ctx.lineWidth = 1
        ctx.fillRect(tl.x, tl.y, boxW, boxH)
        ctx.strokeRect(tl.x, tl.y, boxW, boxH)
        ctx.font = `${LEGEND.font}px "Yu Gothic UI", system-ui, sans-serif`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        entries.forEach((entry, i) => {
          const rowY = tl.y + LEGEND.padding + i * LEGEND.rowH + LEGEND.rowH / 2
          ctx.fillStyle = entry.color
          ctx.fillRect(tl.x + LEGEND.padding, rowY - LEGEND.swatch / 2, LEGEND.swatch, LEGEND.swatch)
          ctx.fillStyle = '#111827'
          ctx.fillText(entry.name, tl.x + LEGEND.padding + LEGEND.swatch + LEGEND.gap, rowY)
        })
        ctx.restore()
      }
    }
```

Add `legendVisible`, `legendPos`, and `facilitiesOnPage` to the component: selectors near the others —

```ts
  const legendVisible = useAreaStore((s) => s.legendVisible)
  const legendPos = useAreaStore((s) => s.legendPos)
  const setLegendPos = useAreaStore((s) => s.setLegendPos)
```

and import `facilitiesOnPage` and `defaultLegendPos` usage (facilitiesOnPage from store; defaultLegendPos is local). Add `facilitiesOnPage` to the store import line. Add `legendVisible`, `legendPos` to that `useEffect`'s dependency array.

- [ ] **Step 3: Make the legend draggable**

Extend `DragState.kind` to include `'legend'` and add a `startPt` reuse. In `DragState`, the union already has `startPt?`; add `'legend'` to the `kind` union type.

Add a legend hit-test helper (after `findMidpointHit`):

```ts
  const legendBounds = (): { x: number; y: number; w: number; h: number } | null => {
    if (!viewport || !legendVisible) return null
    const entries = facilitiesOnPage(state, activePageIndex)
    if (!entries.length) return null
    const ctx = overlayRef.current?.getContext('2d')
    if (!ctx) return null
    const tl = viewportPt(viewport, legendPos ?? defaultLegendPos(viewport))
    const w = legendEntriesWidth(ctx, entries.map((e) => e.name))
    const h = LEGEND.padding * 2 + entries.length * LEGEND.rowH
    return { x: tl.x, y: tl.y, w, h }
  }
```

In `onPointerDown`, immediately after the pan check (`if (shouldPanPointer(...)) { ... return }`) and before `const pdfPt = ...` is used by the calibration/tool branches, add a legend grab. Insert right after the `viewportPoint` is computed (`const viewportPoint = eventToViewportPt(event.nativeEvent, canvas)`):

```ts
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
        moved: false
      })
      return
    }
```

In `onPointerMove`, add a legend branch (after the `'area'` branch):

```ts
    if (drag.kind === 'legend') {
      if (moved) setLegendPos(pdfPt)
      setDrag({ ...drag, moved })
    }
```

- [ ] **Step 4: Toolbar legend toggle**

In `src/renderer/src/components/Toolbar.tsx`, add selectors:

```ts
  const legendVisible = useAreaStore((s) => s.legendVisible)
  const setLegendVisible = useAreaStore((s) => s.setLegendVisible)
```

Add a button in the end group (next to Shortcuts):

```tsx
        <button
          type="button"
          className={legendVisible ? 'is-active' : ''}
          onClick={() => setLegendVisible(!legendVisible)}
        >
          Legend
        </button>
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck:web` — Expected: clean.
Run: `npx vitest run` — Expected: all PASS.
Manual (deferred): a legend box appears on pages with facilities; dragging it moves it and it stays at that position on other pages; the toolbar Legend button hides/shows it.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/PdfStage.tsx src/renderer/src/components/Toolbar.tsx
git commit -m "feat: draggable per-page facility legend overlay with toolbar toggle"
```

---

### Task 12: Legend in the exported PDF

**Files:**
- Create: `src/renderer/src/report/legendImage.ts`
- Create: `src/renderer/src/report/legendImage.spec.ts`
- Modify: `src/renderer/src/report/buildReport.ts`
- Modify: `src/renderer/src/App.tsx` (pass legend state to `buildReportPdf`)

**Interfaces:**
- Consumes: `facilitiesOnPage`, `LegendEntry`, `legendPos`/`legendVisible`.
- Produces: `renderLegendPng(entries: LegendEntry[]): Promise<{ png: Uint8Array; width: number; height: number }>`; `buildReportPdf(originalBytes, png, areas, colors, legend)` extended signature.

- [ ] **Step 1: Write the legend-image smoke test**

Create `src/renderer/src/report/legendImage.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { renderLegendPng } from './legendImage'

function stubCanvas(): void {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    scale: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    set fillStyle(_v) {}, set strokeStyle(_v) {}, set font(_v) {}, set textAlign(_v) {},
    set textBaseline(_v) {}, set lineWidth(_v) {}
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' }))
  }
}

describe('renderLegendPng', () => {
  it('renders a non-empty PNG with positive dimensions', async () => {
    stubCanvas()
    const out = await renderLegendPng([{ name: 'A', color: '#2563eb' }, { name: 'B', color: '#dc2626' }])
    expect(out.png.length).toBeGreaterThan(0)
    expect(out.width).toBeGreaterThan(0)
    expect(out.height).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/report/legendImage.spec.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement the legend PNG renderer**

Create `src/renderer/src/report/legendImage.ts`:

```ts
import type { LegendEntry } from '../state/types'

const FONT_FAMILY = '"Yu Gothic UI","Yu Gothic","Meiryo","MS Gothic",sans-serif'
const ROW_H = 22
const PADDING = 10
const SWATCH = 12
const GAP = 8
const FONT = 13

export interface LegendPng {
  png: Uint8Array
  width: number // CSS px (= PDF points here, dpr-independent)
  height: number
}

export async function renderLegendPng(entries: LegendEntry[]): Promise<LegendPng> {
  const dpr = 2
  const canvas = document.createElement('canvas')
  const measureCtx = canvas.getContext('2d')
  if (!measureCtx) throw new Error('Canvas 2D context unavailable')
  measureCtx.font = `${FONT}px ${FONT_FAMILY}`
  const textW = Math.max(0, ...entries.map((e) => measureCtx.measureText(e.name).width))
  const width = PADDING * 2 + SWATCH + GAP + textW
  const height = PADDING * 2 + entries.length * ROW_H

  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.scale(dpr, dpr)

  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#9ca3af'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1)
  ctx.font = `${FONT}px ${FONT_FAMILY}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  entries.forEach((entry, i) => {
    const rowY = PADDING + i * ROW_H + ROW_H / 2
    ctx.fillStyle = entry.color
    ctx.fillRect(PADDING, rowY - SWATCH / 2, SWATCH, SWATCH)
    ctx.fillStyle = '#111827'
    ctx.fillText(entry.name, PADDING + SWATCH + GAP, rowY)
  })

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('PNG rendering failed'))), 'image/png')
  })
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height }
}
```

- [ ] **Step 4: Embed legends per page in buildReport**

In `src/renderer/src/report/buildReport.ts`, replace the whole file with (adds legend embedding via a passed callback of per-page entries + position):

```ts
import { PDFDocument, rgb, type RGB } from 'pdf-lib'

import type { Area, LegendEntry, Pt } from '../state/types'
import { colorForName } from '../utils/colors'
import { renderLegendPng } from './legendImage'

function colorFromHex(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16)
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)
}

function overlayColor(name: string, colors: Record<string, string>): RGB {
  const custom = colors[name]
  return colorFromHex(/^#[0-9a-f]{6}$/i.test(custom ?? '') ? custom : colorForName(name))
}

function svgPath(points: Area['polygon']): string {
  return `${points.map((pt, index) => `${index === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ')} Z`
}

function drawAreaOverlays(doc: PDFDocument, areas: Area[], colors: Record<string, string>): void {
  const pages = doc.getPages()
  for (const area of areas) {
    const page = pages[area.pageIndex]
    if (!page || area.polygon.length < 3) continue
    const color = overlayColor(area.name, colors)
    page.drawSvgPath(svgPath(area.polygon), {
      color,
      opacity: 0.12,
      borderColor: color,
      borderOpacity: 0.9,
      borderWidth: 1.5
    })
  }
}

export interface LegendOptions {
  visible: boolean
  pos: Pt | null // PDF-point top-left; null → default inset
  entriesForPage(pageIndex: number): LegendEntry[]
}

async function drawLegends(doc: PDFDocument, legend: LegendOptions): Promise<void> {
  if (!legend.visible) return
  const pages = doc.getPages()
  for (let i = 0; i < pages.length; i += 1) {
    const entries = legend.entriesForPage(i)
    if (!entries.length) continue
    const { png, width, height } = await renderLegendPng(entries)
    const img = await doc.embedPng(png)
    const page = pages[i]
    const { width: pw, height: ph } = page.getSize()
    // Default inset: top-left with 24pt margin (PDF origin is bottom-left).
    const topLeft: Pt = legend.pos ?? { x: 24, y: ph - 24 }
    const x = Math.min(Math.max(topLeft.x, 0), Math.max(0, pw - width))
    const yTop = Math.min(Math.max(topLeft.y, height), ph)
    page.drawImage(img, { x, y: yTop - height, width, height })
  }
}

export async function buildReportPdf(
  originalBytes: Uint8Array,
  png: Uint8Array,
  areas: Area[] = [],
  colors: Record<string, string> = {},
  legend?: LegendOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes)
  drawAreaOverlays(doc, areas, colors)
  if (legend) await drawLegends(doc, legend)

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
```

- [ ] **Step 5: Pass legend options from App.generateReport**

In `src/renderer/src/App.tsx`, add `facilitiesOnPage` to the existing store
import (which after Task 9 is `{ areaStore, mmPerPtFor, useAreaStore }`):

```ts
import { areaStore, facilitiesOnPage, mmPerPtFor, useAreaStore } from './state/store'
```

(`renderReportPng` stays imported from `./report/reportImage`, added in Task 9.)
Update the `buildReportPdf` call in `generateReport`:

```ts
    const pdf = await buildReportPdf(state.originalBytes, png, state.areas, state.colors, {
      visible: state.legendVisible,
      pos: state.legendPos,
      entriesForPage: (pageIndex) => facilitiesOnPage(state, pageIndex)
    })
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run` — Expected: all PASS (legend smoke test green).
Run: `npm run typecheck:web` — Expected: clean.
Manual (deferred): generate a report; each page carries its facility legend at the chosen position; hidden when the Legend toggle is off.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/report/legendImage.ts src/renderer/src/report/legendImage.spec.ts src/renderer/src/report/buildReport.ts src/renderer/src/App.tsx
git commit -m "feat: embed the per-page facility legend into the exported report"
```

---

## Notes for the implementer

- Keep `kind` required on `Area`; every construction site must set it. If typecheck complains about a missing `kind`, that's the guardrail working.
- Only `kind:'facility'` areas ever produce m². Any store area contributing to an area total is a bug.
- Store parent linkage is by `name`; do not introduce facility ids.
- The legend's PDF-point position is shared across pages by design (per spec); do not per-page-offset it.
- Deferred manual/GUI verification (drawing, dragging the legend, report visuals) is the controller's to run in the app; unit tests + typecheck are the automated gate.
