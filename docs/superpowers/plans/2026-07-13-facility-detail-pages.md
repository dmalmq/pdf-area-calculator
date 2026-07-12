# Facility Detail Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional per-facility×level detail pages in the exported report: a zoomed vector view of the facility and its stores over a user-aligned screenshot, inserted before the report-table page.

**Architecture:** New `detailPages` state (persisted, project file v3) drives three layers: an InspectorPanel checkbox list for enabling combos, a PdfStage "detail mode" for WYSIWYG image alignment (move/scale/rotate in source-page PDF-point space), and `buildReportPdf` page insertion using a shared pure fit transform (`geometry/detailFit.ts`).

**Tech Stack:** TypeScript, React 19, zustand 4, pdf-lib, pdfjs-dist, vitest 4, Electron (electron-vite).

**Spec:** `docs/superpowers/specs/2026-07-13-facility-detail-pages-design.md`

## Global Constraints

- Tests: `npx vitest run <path>` (no `test` npm script). Typecheck gate: `npm run typecheck`.
- `ProjectFile.version` becomes `1 | 2 | 3`; missing `detailPages` on load → `[]`.
- `detailEditing` is transient: never persisted, never in undo snapshots (`restoreFields`).
- `DetailTransform` is in **source-page PDF-point space**: `x`,`y` = image top-left (visual top, bottom-left-origin space), `scale` = PDF points per image pixel, `rotation` = degrees around image center.
- Detail pages carry no measurements; store tags respect `storeLabelMode`.
- Image imports downscaled to max dimension 2000 px, stored as raw base64 PNG (no `data:` prefix).
- Detail export pages: A4 (595.28 × 841.89), orientation by facility bbox aspect, margin 28, 5% bbox padding, no legend.
- Match repo style (prettier, no semicolons if so configured); conventional commit prefixes.

---

## File Structure

- `src/renderer/src/state/types.ts` — modify: `DetailTransform`, `DetailPage`, `AppState`/`ProjectFile` fields.
- `src/renderer/src/state/store.ts` — modify: actions, `detailCandidates`, pruning, migration, snapshot fields.
- `src/renderer/src/state/store.spec.ts` — modify: new tests.
- `src/renderer/src/geometry/detailFit.ts` (+ `.spec.ts`) — create: `facilityDetailBBox`, `detailFit` (shared by canvas + export).
- `src/renderer/src/utils/importImage.ts` — create: `importImagePng` (decode, downscale, PNG base64).
- `src/renderer/src/components/InspectorPanel.tsx` — modify: "Detail pages" section.
- `src/renderer/src/components/PdfStage.tsx` — modify: detail mode rendering + image alignment interactions.
- `src/renderer/src/App.tsx` — modify: export wiring (and paste/shortcut plumbing if drafted there).
- `src/renderer/src/report/detailHeader.ts` (+ `.spec.ts`) — create: CJK-safe header PNG.
- `src/renderer/src/report/buildReport.ts` (+ `.spec.ts`) — modify: `mapPt` generalization, detail page insertion.

---

### Task 1: Detail-page types, persistence & migration

**Files:**
- Modify: `src/renderer/src/state/types.ts` (add `DetailTransform`, `DetailPage`; extend `ProjectFile` and `AppState`)
- Modify: `src/renderer/src/state/store.ts` (`initialState`, `toProjectFile`, `restoreFields`, `importProject`, `loadDocument`, `AreaStore.importProject` signature)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Produces:
  - `interface DetailTransform { x: number; y: number; scale: number; rotation: number }`
  - `interface DetailPage { name: string; pageIndex: number; image?: string; transform?: DetailTransform }`
  - `AppState.detailPages: DetailPage[]` (persisted, snapshotted) and `AppState.detailEditing: { name: string; pageIndex: number } | null` (transient — NOT persisted, NOT snapshotted)
  - `ProjectFile.version: 1 | 2 | 3` with optional `detailPages?: DetailPage[]`
  - `toProjectFile(state)` writes `version: 3` and `detailPages`
  - `restoreFields(json)` restores `detailPages` (used by undo/redo)
- Consumes: nothing (foundation task)

- [ ] **Step 1: Write the failing tests**

Add these imports at the top of `src/renderer/src/state/store.spec.ts` if not already present: `toProjectFile` is already imported; add `DetailPage` to the type import line so it reads:

```ts
import type { Area, DetailPage, PageState } from './types'
```

Update the existing `toProjectFile round-trips a known persisted project slice` test (currently expecting `version: 2`) so its `expect(...).toEqual({...})` block becomes:

```ts
    expect(toProjectFile(store.getState())).toEqual({
      version: 3,
      fileName: 'plan.pdf',
      pdfPath: 'C:/docs/plan.pdf',
      pages,
      areas: [area],
      names: ['A'],
      colors: { A: '#aabbcc' },
      prefixes: { A: 'ts' },
      legendPos: { x: 1, y: 2 },
      legendVisible: false,
      legendScale: 1.5,
      legendOrientation: 'horizontal',
      storeLabelMode: 'number',
      detailPages: []
    })
```

Then add a new `describe` block at the end of `src/renderer/src/state/store.spec.ts`:

```ts
describe('detail pages persistence', () => {
  const detail: DetailPage = {
    name: 'A',
    pageIndex: 0,
    image: 'BASE64PNG',
    transform: { x: 12, y: 34, scale: 2, rotation: 15 }
  }

  it('serializes detailPages and version 3 in toProjectFile', () => {
    const store = createAreaStore({ detailPages: [detail] })
    const file = toProjectFile(store.getState())
    expect(file.version).toBe(3)
    expect(file.detailPages).toEqual([detail])
  })

  it('does not persist the transient detailEditing field', () => {
    const store = createAreaStore({ detailEditing: { name: 'A', pageIndex: 0 } })
    expect('detailEditing' in toProjectFile(store.getState())).toBe(false)
  })

  it('migrates a v2 project (no detailPages) to an empty array on import', () => {
    const store = createAreaStore({})
    store.getState().importProject({ pages, names: ['A'], areas: [] })
    expect(store.getState().detailPages).toEqual([])
  })

  it('imports detailPages verbatim and closes any open editor', () => {
    const store = createAreaStore({ detailEditing: { name: 'A', pageIndex: 0 } })
    store.getState().importProject({ pages, names: ['A'], areas: [], detailPages: [detail] })
    expect(store.getState().detailPages).toEqual([detail])
    expect(store.getState().detailEditing).toBeNull()
  })

  it('restores detailPages from an undo snapshot', () => {
    const snapshot = JSON.stringify(
      toProjectFile(createAreaStore({ detailPages: [detail] }).getState())
    )
    const store = createAreaStore({ detailPages: [], undoStack: [snapshot] })
    store.getState().undo()
    expect(store.getState().detailPages).toEqual([detail])
  })

  it('resets detailPages and detailEditing when a document is loaded', () => {
    const store = createAreaStore({
      detailPages: [detail],
      detailEditing: { name: 'A', pageIndex: 0 }
    })
    // loadDocument is async and needs a PDF; assert the reset fields are wired via importProject reset instead.
    store.getState().importProject({ pages, names: [], areas: [] })
    expect(store.getState().detailPages).toEqual([])
    expect(store.getState().detailEditing).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: FAIL — the round-trip test fails (`version` is 2, no `detailPages` key), and the new `detail pages persistence` cases fail with type errors / undefined `detailPages` (e.g. `Property 'detailPages' does not exist`, received `version: 2`).

- [ ] **Step 3: Add the types in `types.ts`**

Insert the two interfaces immediately before `export interface ProjectFile {` (currently line 82):

```ts
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
}
```

Change the `ProjectFile.version` field and add `detailPages` — replace line `version: 1 | 2` with:

```ts
  version: 1 | 2 | 3
```

and add, as the last field inside `ProjectFile` (after `storeLabelMode?: StoreLabelMode`):

```ts
  detailPages?: DetailPage[]
```

Add two fields to `AppState`, immediately after `storeLabelMode: StoreLabelMode` (currently line 126):

```ts
  detailPages: DetailPage[]
  detailEditing: { name: string; pageIndex: number } | null
```

- [ ] **Step 4: Wire persistence in `store.ts`**

Add `DetailPage` to the type import block at the top of `store.ts` (the `import type { ... } from './types'` list), inserting it in alphabetical position:

```ts
  CopiedArea,
  DetailPage,
  FacilityLevelRow,
```

Add the two new fields to `initialState` (after `storeLabelMode: 'code',`):

```ts
  detailPages: [],
  detailEditing: null,
```

Update `toProjectFile` to write version 3 and `detailPages` — replace the whole function body:

```ts
export function toProjectFile(state: AppState): ProjectFile {
  return {
    version: 3,
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
    storeLabelMode: state.storeLabelMode,
    detailPages: state.detailPages
  }
}
```

Update `restoreFields` to carry `detailPages` (and NOT `detailEditing`) — replace the whole function:

```ts
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
    storeLabelMode: p.storeLabelMode ?? 'code',
    detailPages: p.detailPages ?? []
  }
}
```

Extend the `importProject` action signature in the `AreaStore` interface — add `detailPages?: DetailPage[]` inside the inline object type, after `storeLabelMode?: StoreLabelMode`:

```ts
    storeLabelMode?: StoreLabelMode
    detailPages?: DetailPage[]
    fileName?: string | null
    pdfPath?: string | null
  }): void
```

In the `importProject` action body, add these two lines to the object passed to `set((state) => ({ ... }))`, immediately after `storeLabelMode: project.storeLabelMode ?? 'code',`:

```ts
        detailPages: (project.detailPages ?? []).map((dp) => ({ ...dp })),
        detailEditing: null,
```

In `loadDocument`, add these two lines to the `set({ ... })` object that resets document state (e.g. immediately after `areas: [],`):

```ts
        detailPages: [],
        detailEditing: null,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: PASS — all `detail pages persistence` cases and the updated round-trip test pass; no other tests regress.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/types.ts src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: add detail-page state types, v3 persistence and migration"
```

---

### Task 2: `detailCandidates` selector, enable/disable & pruning

**Files:**
- Modify: `src/renderer/src/state/store.ts` (add `DetailCandidate`, `detailCandidates`, `pruneDetailPages`; `setDetailPageEnabled` action; `deleteArea` pruning; `editChanged` gains `detailPages`)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Consumes: `DetailPage` / `AppState.detailPages` (Task 1); `restoreFields` restoring `detailPages` (Task 1); the auto-history `store.subscribe`/`editChanged` machinery.
- Produces:
  - `interface DetailCandidate { name: string; pageIndex: number; level: string; stores: number }`
  - `detailCandidates(state: Pick<AppState, 'areas' | 'names' | 'pages'>): DetailCandidate[]` — ordered by `names` order then `pageIndex` ascending; one row per (name, page) combo that has any facility or store polygon; `stores` = count of that name's store-kind areas on that page; `level` = the page label.
  - `setDetailPageEnabled(name: string, pageIndex: number, enabled: boolean): void`
  - `editChanged` now treats a changed `detailPages` reference as an undoable edit.

- [ ] **Step 1: Write the failing tests**

Add `detailCandidates` and `DetailCandidate` to the imports in `src/renderer/src/state/store.spec.ts` — the value import from `./store` gains `detailCandidates`, and add a type import:

```ts
import {
  aggregate,
  colorForBusiness,
  createAreaStore,
  detailCandidates,
  facilitiesOnPage,
  nextStoreCode,
  reportByFacility,
  reportByFacilityLevel,
  reportByLevel,
  renumberStoreCodes,
  selectIsDirty,
  toProjectFile
} from './store'
```

Append a new `describe` block to `src/renderer/src/state/store.spec.ts`:

```ts
describe('detailCandidates and enable/disable', () => {
  it('orders candidates by names order then page ascending, counting stores', () => {
    const store = createAreaStore({
      pages,
      names: ['B', 'A'],
      areas: [
        square(1, 'A'),
        square(0, 'A'),
        storeAt(0, 'A', 3, 3),
        storeAt(0, 'A', 6, 6),
        square(0, 'B')
      ]
    })

    expect(detailCandidates(store.getState())).toEqual([
      { name: 'B', pageIndex: 0, level: 'Page 1', stores: 0 },
      { name: 'A', pageIndex: 0, level: 'Page 1', stores: 2 },
      { name: 'A', pageIndex: 1, level: 'Page 2', stores: 0 }
    ])
  })

  it('lists a store-only combo as a candidate', () => {
    const store = createAreaStore({
      pages,
      names: ['A'],
      areas: [storeAt(1, 'A', 5, 5)]
    })
    expect(detailCandidates(store.getState())).toEqual([
      { name: 'A', pageIndex: 1, level: 'Page 2', stores: 1 }
    ])
  })

  it('enables a combo by appending a DetailPage and is idempotent', () => {
    const store = createAreaStore({ pages, names: ['A'], areas: [square(0, 'A')] })
    store.getState().setDetailPageEnabled('A', 0, true)
    store.getState().setDetailPageEnabled('A', 0, true)
    expect(store.getState().detailPages).toEqual([{ name: 'A', pageIndex: 0 }])
  })

  it('disabling removes the entry and its image', () => {
    const store = createAreaStore({
      detailPages: [
        { name: 'A', pageIndex: 0, image: 'PNG', transform: { x: 0, y: 0, scale: 1, rotation: 0 } }
      ]
    })
    store.getState().setDetailPageEnabled('A', 0, false)
    expect(store.getState().detailPages).toEqual([])
  })

  it('records enable on the undo stack and undo reverts it', () => {
    const store = createAreaStore({ pages, names: ['A'], areas: [square(0, 'A')] })
    store.getState().setDetailPageEnabled('A', 0, true)
    expect(store.getState().detailPages).toEqual([{ name: 'A', pageIndex: 0 }])
    expect(store.getState().undoStack.length).toBeGreaterThan(0)
    store.getState().undo()
    expect(store.getState().detailPages).toEqual([])
  })

  it('prunes a DetailPage when the last polygon of its combo is deleted', () => {
    const facility = square(0, 'A')
    const store = createAreaStore({
      pages,
      names: ['A'],
      areas: [facility],
      detailPages: [{ name: 'A', pageIndex: 0, image: 'PNG' }]
    })
    store.getState().deleteArea(facility.id)
    expect(store.getState().detailPages).toEqual([])
  })

  it('keeps a DetailPage while any polygon of its combo remains', () => {
    const facility = square(0, 'A')
    const other = storeAt(0, 'A', 5, 5)
    const store = createAreaStore({
      pages,
      names: ['A'],
      areas: [facility, other],
      detailPages: [{ name: 'A', pageIndex: 0 }]
    })
    store.getState().deleteArea(facility.id)
    expect(store.getState().detailPages).toEqual([{ name: 'A', pageIndex: 0 }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: FAIL — `detailCandidates is not a function` / `setDetailPageEnabled is not a function`, and the pruning/undo cases fail (`deleteArea` leaves the stale entry; `undo` does not clear it because `editChanged` ignores `detailPages`).

- [ ] **Step 3: Add the `DetailCandidate` type, selector and prune helper**

`DetailCandidate` is declared in `store.ts` (not imported from `types.ts`). Add the interface and selector immediately after the `facilitiesOnPage` function (currently ending at line 343):

```ts
export interface DetailCandidate {
  name: string
  pageIndex: number
  level: string
  stores: number
}

export function detailCandidates(
  state: Pick<AppState, 'areas' | 'names' | 'pages'>
): DetailCandidate[] {
  const result: DetailCandidate[] = []
  for (const name of state.names) {
    const owned = state.areas.filter((area) => area.name === name)
    if (owned.length === 0) continue
    const pageIndices = [...new Set(owned.map((area) => area.pageIndex))].sort((a, b) => a - b)
    for (const pageIndex of pageIndices) {
      const stores = owned.filter(
        (area) => area.pageIndex === pageIndex && area.kind === 'store'
      ).length
      result.push({ name, pageIndex, level: levelOf(state, pageIndex), stores })
    }
  }
  return result
}
```

(`levelOf` is the existing module-private helper at line 222; `Pick<AppState, 'areas' | 'pages'>` is structurally assignable to its `ReportState` parameter.)

Add the prune helper immediately before `export function createAreaStore(` (currently line 472):

```ts
function pruneDetailPages(state: Pick<AppState, 'areas' | 'detailPages'>): DetailPage[] {
  return state.detailPages.filter((dp) =>
    state.areas.some((area) => area.name === dp.name && area.pageIndex === dp.pageIndex)
  )
}
```

- [ ] **Step 4: Make `detailPages` an undoable edit and add the action + pruning**

In `createAreaStore`, extend `editChanged` so a changed `detailPages` reference triggers auto-history — add a line to the boolean chain (after `a.storeLabelMode !== b.storeLabelMode`):

```ts
    a.storeLabelMode !== b.storeLabelMode ||
    a.detailPages !== b.detailPages
```

Replace the `deleteArea` action so it prunes stale detail pages:

```ts
    deleteArea(id) {
      set((state) => {
        const areas = state.areas.filter((candidate) => candidate.id !== id)
        return {
          areas,
          detailPages: pruneDetailPages({ areas, detailPages: state.detailPages }),
          selectedAreaId: state.selectedAreaId === id ? null : state.selectedAreaId
        }
      })
    },
```

Add the `setDetailPageEnabled` action (place it alongside the other new detail actions; e.g. immediately after `deleteArea`). Also declare it in the `AreaStore` interface after `deleteArea(id: string): void`:

Interface line:

```ts
  setDetailPageEnabled(name: string, pageIndex: number, enabled: boolean): void
```

Action:

```ts
    setDetailPageEnabled(name, pageIndex, enabled) {
      set((state) => {
        const exists = state.detailPages.some(
          (dp) => dp.name === name && dp.pageIndex === pageIndex
        )
        if (enabled) {
          if (exists) return {}
          return { detailPages: [...state.detailPages, { name, pageIndex }] }
        }
        if (!exists) return {}
        return {
          detailPages: state.detailPages.filter(
            (dp) => !(dp.name === name && dp.pageIndex === pageIndex)
          )
        }
      })
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: PASS — all `detailCandidates and enable/disable` cases pass; the existing `deleteArea removes the target...` test still passes (pruning is a no-op when there are no detail pages).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: add detailCandidates selector, enable/disable and pruning"
```

---

### Task 3: Editor, image & transform actions

**Files:**
- Modify: `src/renderer/src/state/store.ts` (`openDetailEditor`, `closeDetailEditor`, `setDetailImage`, `setDetailTransform`, `removeDetailImage` + their `AreaStore` interface declarations)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Consumes: `AppState.detailPages` / `AppState.detailEditing` (Task 1); `editChanged` treating `detailPages` as undoable + `restoreFields` (Tasks 1–2); the existing `beginInteraction` / `endInteraction` batching.
- Produces:
  - `openDetailEditor(name: string, pageIndex: number): void` — sets `detailEditing` and switches `activePageIndex` to `pageIndex`, clearing `selectedAreaId`.
  - `closeDetailEditor(): void` — sets `detailEditing` to `null`.
  - `setDetailImage(name: string, pageIndex: number, image: string, transform: DetailTransform): void` — upsert: sets `image`+`transform` on the matching `DetailPage`, appending one if absent.
  - `setDetailTransform(name: string, pageIndex: number, transform: DetailTransform): void` — updates the matching page's `transform`; callers wrap a drag/scale/rotate gesture in `beginInteraction()`/`endInteraction()` so repeated calls coalesce into one undo step.
  - `removeDetailImage(name: string, pageIndex: number): void` — drops `image` and `transform`, keeping the `DetailPage` enabled.

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/renderer/src/state/store.spec.ts`:

```ts
describe('detail editor and image actions', () => {
  const t0 = { x: 0, y: 0, scale: 1, rotation: 0 }
  const t1 = { x: 10, y: 20, scale: 2, rotation: 0 }
  const t2 = { x: 11, y: 21, scale: 2, rotation: 5 }

  it('opens the editor, switches the active page, and clears selection', () => {
    const area = square(1, 'A')
    const store = createAreaStore({
      pages,
      names: ['A'],
      areas: [area],
      selectedAreaId: area.id,
      detailPages: [{ name: 'A', pageIndex: 1 }]
    })
    store.getState().openDetailEditor('A', 1)
    expect(store.getState().detailEditing).toEqual({ name: 'A', pageIndex: 1 })
    expect(store.getState().activePageIndex).toBe(1)
    expect(store.getState().selectedAreaId).toBeNull()
  })

  it('closes the editor without touching detailPages', () => {
    const store = createAreaStore({
      detailPages: [{ name: 'A', pageIndex: 0 }],
      detailEditing: { name: 'A', pageIndex: 0 }
    })
    store.getState().closeDetailEditor()
    expect(store.getState().detailEditing).toBeNull()
    expect(store.getState().detailPages).toEqual([{ name: 'A', pageIndex: 0 }])
  })

  it('opening and closing the editor does not push undo history', () => {
    const store = createAreaStore({ detailPages: [{ name: 'A', pageIndex: 0 }] })
    store.getState().openDetailEditor('A', 0)
    store.getState().closeDetailEditor()
    expect(store.getState().undoStack).toHaveLength(0)
  })

  it('attaches an image and transform to the enabled page', () => {
    const store = createAreaStore({ detailPages: [{ name: 'A', pageIndex: 0 }] })
    store.getState().setDetailImage('A', 0, 'PNG', t1)
    expect(store.getState().detailPages).toEqual([
      { name: 'A', pageIndex: 0, image: 'PNG', transform: t1 }
    ])
  })

  it('setDetailImage upserts when the page is not yet present', () => {
    const store = createAreaStore({ detailPages: [] })
    store.getState().setDetailImage('A', 0, 'PNG', t1)
    expect(store.getState().detailPages).toEqual([
      { name: 'A', pageIndex: 0, image: 'PNG', transform: t1 }
    ])
  })

  it('coalesces a transform gesture into one undo step and reverts it', () => {
    const store = createAreaStore({
      detailPages: [{ name: 'A', pageIndex: 0, image: 'PNG', transform: t0 }]
    })
    store.getState().beginInteraction()
    store.getState().setDetailTransform('A', 0, t1)
    store.getState().setDetailTransform('A', 0, t2)
    store.getState().endInteraction()
    expect(store.getState().detailPages[0].transform).toEqual(t2)
    expect(store.getState().undoStack).toHaveLength(1)
    store.getState().undo()
    expect(store.getState().detailPages[0].transform).toEqual(t0)
  })

  it('removes the image but keeps the page enabled', () => {
    const store = createAreaStore({
      detailPages: [{ name: 'A', pageIndex: 0, image: 'PNG', transform: t1 }]
    })
    store.getState().removeDetailImage('A', 0)
    expect(store.getState().detailPages).toEqual([{ name: 'A', pageIndex: 0 }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: FAIL — `openDetailEditor is not a function` (and the other four actions), so every case in the new block throws.

- [ ] **Step 3: Declare the actions on the `AreaStore` interface**

Add these lines to the `AreaStore` interface (group them after `setDetailPageEnabled(...)` from Task 2):

```ts
  setDetailImage(name: string, pageIndex: number, image: string, transform: DetailTransform): void
  setDetailTransform(name: string, pageIndex: number, transform: DetailTransform): void
  removeDetailImage(name: string, pageIndex: number): void
  openDetailEditor(name: string, pageIndex: number): void
  closeDetailEditor(): void
```

Add `DetailTransform` to the `import type { ... } from './types'` block in `store.ts` (alphabetical, right after `DetailPage,`):

```ts
  DetailPage,
  DetailTransform,
```

- [ ] **Step 4: Implement the actions**

Add these actions inside the `createStore<AreaStore>((set, get) => ({ ... }))` object (place them next to `setDetailPageEnabled` from Task 2):

```ts
    openDetailEditor(name, pageIndex) {
      set({ detailEditing: { name, pageIndex }, activePageIndex: pageIndex, selectedAreaId: null })
    },
    closeDetailEditor() {
      set({ detailEditing: null })
    },
    setDetailImage(name, pageIndex, image, transform) {
      set((state) => {
        const exists = state.detailPages.some(
          (dp) => dp.name === name && dp.pageIndex === pageIndex
        )
        const detailPages = exists
          ? state.detailPages.map((dp) =>
              dp.name === name && dp.pageIndex === pageIndex ? { ...dp, image, transform } : dp
            )
          : [...state.detailPages, { name, pageIndex, image, transform }]
        return { detailPages }
      })
    },
    setDetailTransform(name, pageIndex, transform) {
      set((state) => ({
        detailPages: state.detailPages.map((dp) =>
          dp.name === name && dp.pageIndex === pageIndex ? { ...dp, transform } : dp
        )
      }))
    },
    removeDetailImage(name, pageIndex) {
      set((state) => ({
        detailPages: state.detailPages.map((dp) =>
          dp.name === name && dp.pageIndex === pageIndex
            ? { name: dp.name, pageIndex: dp.pageIndex }
            : dp
        )
      }))
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: PASS — all `detail editor and image actions` cases pass; existing undo/redo tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: add detail editor, image and transform store actions"
```

---

### Task 4: `detailFit` geometry and PNG import helper

**Files:**
- Create: `src/renderer/src/geometry/detailFit.ts`
- Test: `src/renderer/src/geometry/detailFit.spec.ts`
- Create: `src/renderer/src/utils/importImage.ts`
- Test: `src/renderer/src/utils/importImage.spec.ts`

**Interfaces:**
- Consumes: `Area`, `Pt` from `../state/types`.
- Produces:
  - `interface BBox { x: number; y: number; w: number; h: number }` (PDF points, bottom-left origin)
  - `facilityDetailBBox(areas: Area[], name: string, pageIndex: number): BBox | null` — union of the outer-ring vertices of every facility+store polygon for `(name, pageIndex)`, no padding; `null` when none match.
  - `detailFit(bbox: BBox, avail: { width: number; height: number }): { scale: number; offsetX: number; offsetY: number }` — pads `bbox` 5% per side, uniform fit, centered. Offsets are avail-local (origin 0,0 at avail bottom-left, y up, same orientation as input). Consumers map a point with `paddedBBox.x = bbox.x - 0.05 * bbox.w` (y likewise): `tx = (p.x - paddedBBox.x) * scale + offsetX`.
  - `interface ImportedImage { dataBase64: string; width: number; height: number }`
  - `importImagePng(blob: Blob, maxDim?: number): Promise<ImportedImage>` — decodes, downscales so `max(width, height) <= maxDim` (default 2000, never upscales), re-encodes PNG, returns raw base64 (no `data:` prefix).

- [ ] **Step 1: Write the failing tests for `detailFit`**

Create `src/renderer/src/geometry/detailFit.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { detailFit, facilityDetailBBox } from './detailFit'
import type { Area } from '../state/types'

const rect = (
  pageIndex: number,
  name: string,
  kind: Area['kind'],
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Area => ({
  id: crypto.randomUUID(),
  pageIndex,
  kind,
  name,
  polygon: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 }
  ]
})

describe('facilityDetailBBox', () => {
  it('returns null when nothing matches', () => {
    expect(facilityDetailBBox([], 'A', 0)).toBeNull()
    expect(facilityDetailBBox([rect(0, 'A', 'facility', 0, 0, 10, 10)], 'B', 0)).toBeNull()
    expect(facilityDetailBBox([rect(0, 'A', 'facility', 0, 0, 10, 10)], 'A', 1)).toBeNull()
  })

  it('returns the bbox of a single polygon', () => {
    expect(facilityDetailBBox([rect(0, 'A', 'facility', 2, 3, 12, 8)], 'A', 0)).toEqual({
      x: 2,
      y: 3,
      w: 10,
      h: 5
    })
  })

  it('unions facility and store polygons on the same page', () => {
    const areas = [
      rect(0, 'A', 'facility', 0, 0, 10, 10),
      rect(0, 'A', 'store', 12, -4, 16, 6),
      rect(0, 'A', 'facility', 1, 1, 20, 20) // holes irrelevant; outer ring wins
    ]
    expect(facilityDetailBBox(areas, 'A', 0)).toEqual({ x: 0, y: -4, w: 20, h: 24 })
  })

  it('ignores areas from other pages or names', () => {
    const areas = [
      rect(0, 'A', 'facility', 0, 0, 10, 10),
      rect(1, 'A', 'facility', 0, 0, 100, 100),
      rect(0, 'B', 'facility', 0, 0, 100, 100)
    ]
    expect(facilityDetailBBox(areas, 'A', 0)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
})

describe('detailFit', () => {
  it('fits a square bbox with 5% padding into a matching square area', () => {
    // paddedW = paddedH = 110; scale = 110/110 = 1; centered => no offset
    expect(detailFit({ x: 0, y: 0, w: 100, h: 100 }, { width: 110, height: 110 })).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0
    })
  })

  it('binds on width for a wide bbox and centers vertically', () => {
    // paddedW = 220, paddedH = 110; scale = min(220/220, 220/110) = 1
    // offsetX = (220 - 220)/2 = 0; offsetY = (220 - 110)/2 = 55
    expect(detailFit({ x: 0, y: 0, w: 200, h: 100 }, { width: 220, height: 220 })).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 55
    })
  })

  it('binds on height for a tall bbox and centers horizontally', () => {
    // paddedW = 110, paddedH = 220; scale = min(220/110, 220/220) = 1
    // offsetX = (220 - 110)/2 = 55; offsetY = 0
    expect(detailFit({ x: 0, y: 0, w: 100, h: 200 }, { width: 220, height: 220 })).toEqual({
      scale: 1,
      offsetX: 55,
      offsetY: 0
    })
  })

  it('maps the bbox center to the center of the available area', () => {
    const bbox = { x: 10, y: 20, w: 100, h: 100 }
    const avail = { width: 110, height: 110 }
    const { scale, offsetX, offsetY } = detailFit(bbox, avail)
    const paddedX = bbox.x - 0.05 * bbox.w
    const paddedY = bbox.y - 0.05 * bbox.h
    const center = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }
    const tx = (center.x - paddedX) * scale + offsetX
    const ty = (center.y - paddedY) * scale + offsetY
    expect(tx).toBeCloseTo(avail.width / 2, 6)
    expect(ty).toBeCloseTo(avail.height / 2, 6)
  })

  it('down-scales when the padded bbox is larger than the available area', () => {
    // paddedW = paddedH = 220; scale = 110/220 = 0.5
    const fit = detailFit({ x: 0, y: 0, w: 200, h: 200 }, { width: 110, height: 110 })
    expect(fit.scale).toBeCloseTo(0.5, 6)
    expect(fit.offsetX).toBeCloseTo(0, 6)
    expect(fit.offsetY).toBeCloseTo(0, 6)
  })
})
```

- [ ] **Step 2: Run the geometry tests to verify they fail**

Run: `npx vitest run src/renderer/src/geometry/detailFit.spec.ts`
Expected: FAIL — `Cannot find module './detailFit'` (the file does not exist yet).

- [ ] **Step 3: Implement `detailFit.ts`**

Create `src/renderer/src/geometry/detailFit.ts`:

```ts
import type { Area } from '../state/types'

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

// Union bbox of every facility+store polygon (outer rings) for a (name, page)
// combo, in PDF points; null when no polygon matches. Holes never grow the bbox.
export function facilityDetailBBox(areas: Area[], name: string, pageIndex: number): BBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false
  for (const area of areas) {
    if (area.name !== name || area.pageIndex !== pageIndex) continue
    for (const pt of area.polygon) {
      found = true
      if (pt.x < minX) minX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.x > maxX) maxX = pt.x
      if (pt.y > maxY) maxY = pt.y
    }
  }
  if (!found) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// Pad the bbox 5% per side, fit it uniformly into `avail`, and center it.
// Offsets are avail-local (origin bottom-left, y up). A point maps as
// tx = (p.x - (bbox.x - 0.05*bbox.w)) * scale + offsetX (y likewise).
export function detailFit(
  bbox: BBox,
  avail: { width: number; height: number }
): { scale: number; offsetX: number; offsetY: number } {
  const paddedW = bbox.w * 1.1
  const paddedH = bbox.h * 1.1
  const scale = Math.min(avail.width / paddedW, avail.height / paddedH)
  const offsetX = (avail.width - paddedW * scale) / 2
  const offsetY = (avail.height - paddedH * scale) / 2
  return { scale, offsetX, offsetY }
}
```

- [ ] **Step 4: Run the geometry tests to verify they pass**

Run: `npx vitest run src/renderer/src/geometry/detailFit.spec.ts`
Expected: PASS — all `facilityDetailBBox` and `detailFit` cases pass.

- [ ] **Step 5: Write the failing test for `importImagePng`**

Create `src/renderer/src/utils/importImage.spec.ts`. This mirrors `report/legendImage.spec.ts`: canvas has no real 2D backend under vitest, so we stub `createImageBitmap` and `document.createElement` and let the function's downscale math drive the returned dimensions.

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { importImagePng } from './importImage'

// Stubs a decoded bitmap of the given source size and a canvas whose toBlob
// yields fixed PNG bytes; the canvas records the dimensions the function sets.
function setupCanvas(srcW: number, srcH: number): { canvas: { width: number; height: number } } {
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    toBlob: vi.fn((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
    )
  }
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: srcW, height: srcH, close: vi.fn() }))
  )
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
  return { canvas }
}

describe('importImagePng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('downscales so the longest side is at most maxDim', async () => {
    setupCanvas(4000, 2000)
    const out = await importImagePng(new Blob(), 2000)
    expect(out.width).toBe(2000)
    expect(out.height).toBe(1000)
  })

  it('never upscales a small image', async () => {
    setupCanvas(300, 200)
    const out = await importImagePng(new Blob(), 2000)
    expect(out.width).toBe(300)
    expect(out.height).toBe(200)
  })

  it('uses a default max dimension of 2000', async () => {
    setupCanvas(6000, 3000)
    const out = await importImagePng(new Blob())
    expect(Math.max(out.width, out.height)).toBe(2000)
  })

  it('returns raw base64 without a data: prefix', async () => {
    setupCanvas(100, 100)
    const out = await importImagePng(new Blob())
    expect(out.dataBase64.length).toBeGreaterThan(0)
    expect(out.dataBase64.startsWith('data:')).toBe(false)
  })
})
```

- [ ] **Step 6: Run the import test to verify it fails**

Run: `npx vitest run src/renderer/src/utils/importImage.spec.ts`
Expected: FAIL — `Cannot find module './importImage'` (the file does not exist yet).

- [ ] **Step 7: Implement `importImage.ts`**

Create `src/renderer/src/utils/importImage.ts`:

```ts
export interface ImportedImage {
  dataBase64: string // raw base64 PNG, no data: prefix
  width: number
  height: number
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Decode an image blob, downscale so max(width, height) <= maxDim (never
// upscaling), re-encode as PNG, and return raw base64 plus the final size.
export async function importImagePng(blob: Blob, maxDim = 2000): Promise<ImportedImage> {
  const bitmap = await createImageBitmap(blob)
  const factor = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * factor))
  const height = Math.max(1, Math.round(bitmap.height * factor))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('PNG encoding failed'))),
      'image/png'
    )
  })
  const bytes = new Uint8Array(await png.arrayBuffer())
  return { dataBase64: base64FromBytes(bytes), width, height }
}
```

- [ ] **Step 8: Run the import test to verify it passes**

Run: `npx vitest run src/renderer/src/utils/importImage.spec.ts`
Expected: PASS — all `importImagePng` cases pass.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/geometry/detailFit.ts src/renderer/src/geometry/detailFit.spec.ts src/renderer/src/utils/importImage.ts src/renderer/src/utils/importImage.spec.ts
git commit -m "feat: add detailFit geometry and PNG import helper"
```

### Task 5: InspectorPanel "Detail pages" section

**Files:**
- Modify: `src/renderer/src/components/InspectorPanel.tsx`
- Modify: `src/renderer/src/i18n/messages.ts` (add detail keys under both `ja` and `en`)
- Modify: `src/renderer/src/assets/main.css` (detail list styles)

**Interfaces:**
- Consumes (from Tasks 1–4):
  - `AppState.detailPages: DetailPage[]`, `DetailPage { name: string; pageIndex: number; image?: string; transform?: DetailTransform }`
  - `setDetailPageEnabled(name: string, pageIndex: number, enabled: boolean): void`
  - `openDetailEditor(name: string, pageIndex: number): void`
  - `setActivePage(index: number): void` (existing)
  - `detailCandidates(state: Pick<AppState, 'areas' | 'names' | 'pages'>): DetailCandidate[]`, `DetailCandidate { name: string; pageIndex: number; level: string; stores: number }` — exported from `state/store.ts`
- Produces: nothing consumed by later tasks (UI-only).

This task has no unit-testable pure logic; it renders store selectors. Verification is
`npm run typecheck` plus a manual click-path in `npm run dev`.

- [ ] **Step 1: Add i18n keys**

In `src/renderer/src/i18n/messages.ts`, inside the `ja` map, immediately after the
`'storeLabel.renumber': '番号を振り直す',` line (currently line 107) insert:

```ts
    'detail.heading': '詳細ページ',
    'detail.empty': '施設ポリゴンを描画すると候補が表示されます。',
    'detail.stores': '{n} 店舗',
    'detail.edit': '編集',
    'detail.done': '完了',
    'detail.addImage': '画像を追加…',
    'detail.removeImage': '画像を削除',
    'detail.hint': 'ドラッグで移動、スクロールで拡大縮小、Shift+スクロールで回転。',
```

In the `en` map, immediately after `'storeLabel.renumber': 'Renumber stores',` (currently
line 298) insert:

```ts
    'detail.heading': 'Detail pages',
    'detail.empty': 'Draw facility polygons to see candidates.',
    'detail.stores': '{n} stores',
    'detail.edit': 'Edit',
    'detail.done': 'Done',
    'detail.addImage': 'Add image…',
    'detail.removeImage': 'Remove image',
    'detail.hint': 'Drag to move · scroll to scale · Shift+scroll to rotate.',
```

Also add the paste-error toast key. In the `ja` map, immediately after
`'toast.noPaste': '貼り付けるエリアがありません',` (currently line 183) insert:

```ts
    'toast.detail.notImage': 'クリップボードに画像がありません',
```

In the `en` map, immediately after `'toast.noPaste': 'Nothing to paste',` (currently
line 374) insert:

```ts
    'toast.detail.notImage': 'No image on the clipboard',
```

- [ ] **Step 2: Import the selector and wire store actions**

In `src/renderer/src/components/InspectorPanel.tsx`, change the store import (line 4)
from:

```ts
import { areaM2, mmPerPtFor, useAreaStore } from '../state/store'
```

to:

```ts
import { areaM2, detailCandidates, mmPerPtFor, useAreaStore } from '../state/store'
```

Then, immediately after the existing `const mmPerPt = useAreaStore(...)` selector line
(currently line 57), add these selectors:

```ts
  const detailPages = useAreaStore((s) => s.detailPages)
  const setActivePage = useAreaStore((s) => s.setActivePage)
  const setDetailPageEnabled = useAreaStore((s) => s.setDetailPageEnabled)
  const openDetailEditor = useAreaStore((s) => s.openDetailEditor)
```

- [ ] **Step 3: Derive the candidate list**

Immediately after the existing `const custom = ...` derived line (currently line 72), add:

```ts
  const candidates = useMemo(
    () => detailCandidates({ areas, names, pages }),
    [areas, names, pages]
  )
```

(`useMemo` is already imported; `areas`, `names`, `pages` selectors already exist.)

- [ ] **Step 4: Render the "Detail pages" disclosure in the Page tab**

The Page tab renders a `<>...</>` fragment. The last block before its closing `</>` is the
store-label `<div className="pane-section">...</div>` (ends at the `</div>` on the line
before `</>` / `) : null}` around line 335). Insert this `<details>` block immediately
after that store-label `</div>` and before the fragment closes:

```tsx
              <details className="disclosure">
                <summary>{t('detail.heading')}</summary>
                {candidates.length === 0 ? (
                  <p className="hint">{t('detail.empty')}</p>
                ) : (
                  <ul className="detail-list">
                    {candidates.map((candidate) => {
                      const enabled = detailPages.some(
                        (dp) => dp.name === candidate.name && dp.pageIndex === candidate.pageIndex
                      )
                      return (
                        <li
                          key={`${candidate.name}@${candidate.pageIndex}`}
                          className="detail-row"
                        >
                          <label className="detail-row__label">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(event) =>
                                setDetailPageEnabled(
                                  candidate.name,
                                  candidate.pageIndex,
                                  event.target.checked
                                )
                              }
                            />
                            <span className="detail-row__name">{candidate.name}</span>
                            <span className="detail-row__meta">
                              {candidate.level} · {t('detail.stores', { n: candidate.stores })}
                            </span>
                          </label>
                          {enabled ? (
                            <button
                              type="button"
                              className="btn btn--icon"
                              onClick={() => {
                                setActivePage(candidate.pageIndex)
                                openDetailEditor(candidate.name, candidate.pageIndex)
                              }}
                            >
                              {t('detail.edit')}
                            </button>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </details>
```

- [ ] **Step 5: Add list styles**

Append to `src/renderer/src/assets/main.css`:

```css
.detail-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.detail-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.detail-row__label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.detail-row__name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-row__meta {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors (both `typecheck:node` and `typecheck:web`).

- [ ] **Step 7: Manual verification**

Run: `npm run dev`
Click-path:
1. Open a PDF (`file.openPdf`) that has at least one facility polygon and one store
   polygon drawn (or open an existing project).
2. Open the Inspector, Page tab; expand **Detail pages**.
Expected observations:
- Each facility×page combo with any facility or store polygon appears as a row showing
  `施設名 / facility name`, the page level, and `N stores` / `N 店舗`.
- Checking a row's checkbox reveals an **Edit** (`編集`) button on that row; unchecking hides it.
- Clicking **Edit** switches the active page to that candidate's page (the page label in the
  stage status bar changes) and enters detail mode (the stage turns white — implemented in
  Task 6; before Task 6 the button still runs without error).
- With no polygons on the document, the section shows the empty hint.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/InspectorPanel.tsx src/renderer/src/i18n/messages.ts src/renderer/src/assets/main.css
git commit -m "feat: add Detail pages selection section to inspector"
```

---

### Task 6: PdfStage detail-mode rendering

**Files:**
- Modify: `src/renderer/src/components/PdfStage.tsx`
- Modify: `src/renderer/src/assets/main.css` (detail-mode stage + toolbar styles)
- Test: `src/renderer/src/components/PdfStage.spec.ts`

**Interfaces:**
- Consumes (from Tasks 1–4):
  - `AppState.detailEditing: { name: string; pageIndex: number } | null`
  - `AppState.detailPages: DetailPage[]`, `DetailPage { name; pageIndex; image?; transform? }`,
    `DetailTransform { x: number; y: number; scale: number; rotation: number }`
  - `removeDetailImage(name: string, pageIndex: number): void`
  - `closeDetailEditor(): void`
  - `facilityDetailBBox(areas: Area[], name: string, pageIndex: number): BBox | null`,
    `BBox { x: number; y: number; w: number; h: number }` — from `src/renderer/src/geometry/detailFit.ts`
- Produces (exported from `PdfStage.tsx`, consumed by Task 7 and tests):
  - `detailFrame(input: { rectX: number; rectY: number; rectW: number; rectH: number; containerW: number; containerH: number; margin: number }): { zoom: number; pan: Pt }`

**Concrete framing decision (derived from the code):** the stage already maps PDF points to
overlay pixels with `viewportPt(viewport, pt)` (a fixed `scale: 1.5` viewport) and then displays
the `.pdf-stage` wrapper stretched by the store's `zoom`, scrolled by `pan`
(`scrollRef.scrollLeft/Top`). Detail mode **reuses this exact zoom/pan machinery** rather than
introducing a separate detail scale: on entering detail mode we compute a one-shot `zoom` and
`pan` that frame the padded facility bbox and push them through the existing `setZoom`/`setPan`.
The whole overlay draw path (which already uses `viewportPt` + CSS zoom) then works unchanged; we
only branch it to draw the image + this facility's areas and to hide the PDF bitmap. Wheel zoom is
repurposed in detail mode (Task 7), so the framing zoom stays put.

- [ ] **Step 1: Write the failing test for `detailFrame`**

Append to `src/renderer/src/components/PdfStage.spec.ts`:

```ts
import { detailFrame } from './PdfStage'

describe('detailFrame', () => {
  it('fits the bbox rect to the container and centers it (margin-aware)', () => {
    // rect 100x100 viewport-px at (10,20); container 500x400; 32px stage margin.
    // fit = min(500/100, 400/100) = 4.
    // pan.x = 32 + 10*4 - (500 - 100*4)/2 = 72 - 50 = 22
    // pan.y = 32 + 20*4 - (400 - 100*4)/2 = 112 - 0 = 112
    expect(
      detailFrame({
        rectX: 10,
        rectY: 20,
        rectW: 100,
        rectH: 100,
        containerW: 500,
        containerH: 400,
        margin: 32
      })
    ).toEqual({ zoom: 4, pan: { x: 22, y: 112 } })
  })

  it('clamps the framing zoom to the stage zoom range', () => {
    const framed = detailFrame({
      rectX: 0,
      rectY: 0,
      rectW: 1,
      rectH: 1,
      containerW: 5000,
      containerH: 5000,
      margin: 0
    })
    expect(framed.zoom).toBe(8)
  })
})
```

(Add `import { detailFrame } from './PdfStage'` alongside the existing PdfStage import; keep the
existing `describe` blocks.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts`
Expected: FAIL — `detailFrame` is not exported ("No known export 'detailFrame'").

- [ ] **Step 3: Implement `detailFrame` and the stage-margin constant**

In `src/renderer/src/components/PdfStage.tsx`, add a module-level constant next to the other
top-level consts (e.g. right after `const TAG = {...}`, around line 95):

```ts
// `.pdf-stage` margin in main.css; the wrapper's content origin is offset by this
// inside the scroll container, so framing math must add it back.
const STAGE_MARGIN = 32
```

Add this exported pure helper next to the other exported helpers (e.g. right after
`anchoredZoomScroll`, around line 186):

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts`
Expected: PASS (all `detailFrame` cases plus the pre-existing helper tests).

- [ ] **Step 5: Add detail-mode imports and store selectors**

In `PdfStage.tsx`, extend the types import (line 14) to add `DetailTransform`:

```ts
import type { AppState, Area, DetailTransform, LegendOrientation, Pt, Tool } from '../state/types'
```

Add the geometry helper import next to the other imports (after the `../geometry/area` import,
line 4):

```ts
import { facilityDetailBBox } from '../geometry/detailFit'
```

Inside the component, after the existing `endInteraction` selector (around line 236), add:

```ts
  const detailEditing = useAreaStore((s) => s.detailEditing)
  const detailPages = useAreaStore((s) => s.detailPages)
  const removeDetailImage = useAreaStore((s) => s.removeDetailImage)
  const closeDetailEditor = useAreaStore((s) => s.closeDetailEditor)
```

Add the image element cache and a redraw epoch alongside the other refs/state (after the `drag`
state, around line 246):

```ts
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map())
  const [imageEpoch, setImageEpoch] = useState(0)
```

- [ ] **Step 6: Add the cached-image getter and the current-detail derivation**

After `const selectedArea = ...` (around line 254), add:

```ts
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
```

- [ ] **Step 7: Branch the draw effect for detail mode**

In the overlay draw `useEffect`, `drawPolygon` is defined inside the effect. Immediately after
the `ctx.clearRect(0, 0, canvas.width, canvas.height)` line and after the `drawPolygon` function
definition (i.e. right before `pageAreas.forEach((area) => drawPolygon(...))`, around line 334),
insert a detail-mode branch that draws and returns early:

```ts
    if (detailEditing) {
      if (currentDetail?.image && currentDetail.transform) {
        const img = getDetailImage(currentDetail.image)
        if (img) {
          const s = viewport.scale * currentDetail.transform.scale
          const cx = currentDetail.transform.x + (img.naturalWidth * currentDetail.transform.scale) / 2
          const cy = currentDetail.transform.y - (img.naturalHeight * currentDetail.transform.scale) / 2
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
```

Extend the draw effect's dependency array to include the new inputs. Add these entries to the
existing dependency list:

```ts
    areas,
    currentDetail,
    detailEditing,
    getDetailImage,
    imageEpoch,
```

- [ ] **Step 8: Add the Esc-to-close listener**

Add a new `useEffect` after the existing keydown effect (after its closing `}, [...])`, around
line 555):

```ts
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
```

- [ ] **Step 9: Disable normal interactions in detail mode**

In `onPointerDown`, immediately after the two lines computing `pdfPt` and `viewportPoint` and
before the `if (holeTarget)` block (around line 641), insert a detail-mode guard that swallows all
non-pan pointer input (Task 7 replaces the inner body with image hit-testing; for now it just
blocks draw/edit/calibration):

```ts
    if (detailEditing) {
      return
    }
```

(The pan branch above this already `return`ed, so middle-drag / pan-tool panning still works.)

- [ ] **Step 10: Render the white background, hide the PDF bitmap, and add the detail toolbar**

In the JSX, change the wrapper `div` (around line 914) to toggle a detail class:

```tsx
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
```

(Leave the `overlay-canvas` element and its handlers unchanged.)

Add the floating detail toolbar as a sibling right after the `zoom-cluster` block (after its
`) : null}`, around line 962):

```tsx
      {detailEditing ? (
        <div className="detail-toolbar">
          <span className="detail-toolbar__hint">{t('detail.hint')}</span>
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
```

(The **Add image…** button and its hidden file input are added in Task 7.)

- [ ] **Step 11: Add detail-mode stage styles**

Append to `src/renderer/src/assets/main.css`:

```css
.pdf-stage.is-detail {
  background: #ffffff;
}

.detail-toolbar {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: rgba(17, 24, 39, 0.92);
  color: #ffffff;
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
  z-index: 5;
}

.detail-toolbar__hint {
  font-size: 12px;
  white-space: nowrap;
}
```

- [ ] **Step 12: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 13: Manual verification**

Run: `npm run dev`
Click-path:
1. Open a PDF with a facility + a couple of store polygons.
2. Inspector → Page tab → Detail pages → check a row → click **Edit**.
Expected observations:
- The stage background turns white (PDF bitmap hidden) and auto-frames so the facility's
  polygons + stores fill the visible stage (padded ~5%).
- Only that facility's polygons/stores (and their tags, honoring the store-label mode) are drawn;
  other facilities are gone.
- A floating dark toolbar appears bottom-center with the controls hint and a **Done** (`完了`)
  button; **Remove image** does not appear yet (no image).
- Pressing **Esc** or clicking **Done** exits detail mode: the PDF bitmap reappears and full
  overlays return.
- While in detail mode, clicking on the canvas with the draw/edit tools does nothing (no new
  vertices, no selection); middle-drag / pan tool still pans.

- [ ] **Step 14: Commit**

```bash
git add src/renderer/src/components/PdfStage.tsx src/renderer/src/components/PdfStage.spec.ts src/renderer/src/assets/main.css
git commit -m "feat: render facility detail mode on the canvas"
```

---

### Task 7: Detail image input and alignment interactions

**Files:**
- Modify: `src/renderer/src/components/PdfStage.tsx`
- Test: `src/renderer/src/components/PdfStage.spec.ts`

**Interfaces:**
- Consumes (from Tasks 1–4 and Task 6):
  - `setDetailImage(name: string, pageIndex: number, image: string, transform: DetailTransform): void`
  - `setDetailTransform(name: string, pageIndex: number, transform: DetailTransform): void`
  - `beginInteraction(): void` / `endInteraction(): void` (existing, already selected)
  - `facilityDetailBBox(areas: Area[], name: string, pageIndex: number): BBox | null` (imported in Task 6)
  - `importImagePng(blob: Blob, maxDim?: number): Promise<{ dataBase64: string; width: number; height: number }>` — from `src/renderer/src/utils/importImage.ts`
  - `detailEditing`, `currentDetail`, `getDetailImage`, `STAGE_MARGIN` (from Task 6)
- Produces (exported from `PdfStage.tsx`, consumed by tests):
  - `inverseImagePoint(pt: Pt, center: Pt, s: number, rotationRad: number, imgW: number, imgH: number): Pt`
  - `pointInImageRect(local: Pt, imgW: number, imgH: number): boolean`
  - `scaleDetailAboutCursor(t: DetailTransform, imgW: number, imgH: number, cursor: Pt, factor: number): DetailTransform`

- [ ] **Step 1: Write the failing tests for the alignment helpers**

Append to `src/renderer/src/components/PdfStage.spec.ts`:

```ts
import { inverseImagePoint, pointInImageRect, scaleDetailAboutCursor } from './PdfStage'

describe('inverseImagePoint', () => {
  it('inverse-maps a viewport point to image-local pixels (no rotation)', () => {
    // center at (100,100) viewport-px, 2 viewport-px per image-px, 10x10 image.
    expect(inverseImagePoint({ x: 100, y: 100 }, { x: 100, y: 100 }, 2, 0, 10, 10)).toEqual({
      x: 5,
      y: 5
    })
    expect(inverseImagePoint({ x: 102, y: 100 }, { x: 100, y: 100 }, 2, 0, 10, 10)).toEqual({
      x: 6,
      y: 5
    })
  })

  it('un-rotates by the transform rotation before scaling into image space', () => {
    // rotated 90°: a point 2px below center maps back onto the +x image axis.
    const r = inverseImagePoint({ x: 100, y: 102 }, { x: 100, y: 100 }, 2, Math.PI / 2, 10, 10)
    expect(r.x).toBeCloseTo(6)
    expect(r.y).toBeCloseTo(5)
  })
})

describe('pointInImageRect', () => {
  it('accepts points inside the image rect and rejects points outside', () => {
    expect(pointInImageRect({ x: 5, y: 5 }, 10, 10)).toBe(true)
    expect(pointInImageRect({ x: 0, y: 10 }, 10, 10)).toBe(true)
    expect(pointInImageRect({ x: -1, y: 5 }, 10, 10)).toBe(false)
    expect(pointInImageRect({ x: 11, y: 5 }, 10, 10)).toBe(false)
  })
})

describe('scaleDetailAboutCursor', () => {
  it('keeps the cursor-anchored image point fixed while scaling', () => {
    // cursor at the image top-left corner (PDF 0,0) → scaling leaves top-left in place.
    expect(
      scaleDetailAboutCursor({ x: 0, y: 0, scale: 1, rotation: 0 }, 10, 10, { x: 0, y: 0 }, 2)
    ).toEqual({ x: 0, y: 0, scale: 2, rotation: 0 })
  })

  it('moves the top-left so the cursor stays anchored when it is off-corner', () => {
    // image top-left (0,0), scale 1, 10x10 → center PDF (5,-5). Cursor at center, factor 2.
    // center is fixed, so new top-left = (5 - 10*2/2, -5 + 10*2/2) = (-5, 5).
    const r = scaleDetailAboutCursor({ x: 0, y: 0, scale: 1, rotation: 0 }, 10, 10, { x: 5, y: -5 }, 2)
    expect(r.x).toBeCloseTo(-5)
    expect(r.y).toBeCloseTo(5)
    expect(r.scale).toBeCloseTo(2)
    expect(r.rotation).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts`
Expected: FAIL — `inverseImagePoint`, `pointInImageRect`, `scaleDetailAboutCursor` are not exported.

- [ ] **Step 3: Implement the pure alignment helpers**

In `PdfStage.tsx`, add these exported helpers next to `detailFrame` (around line 186):

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts`
Expected: PASS (all alignment-helper cases plus the earlier PdfStage tests).

- [ ] **Step 5: Add the image-import helper import, the DragState kind, and refs**

In `PdfStage.tsx`, add the import next to the geometry import (after the
`../geometry/detailFit` import from Task 6):

```ts
import { importImagePng } from '../utils/importImage'
```

Extend the `DragState` interface (around lines 36–48): add `'detailImage'` to the `kind` union
and a `startTransform` field:

```ts
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
```

Add the two remaining store actions and a wheel-batch ref inside the component. After the
`closeDetailEditor` selector (from Task 6), add:

```ts
  const setDetailImage = useAreaStore((s) => s.setDetailImage)
  const setDetailTransform = useAreaStore((s) => s.setDetailTransform)
```

Next to `imageCache`/`imageEpoch` (from Task 6), add the file-input ref and the wheel batch timer:

```ts
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wheelBatch = useRef<number | null>(null)
```

- [ ] **Step 6: Add the placement + import handlers and the paste listener**

Import the imperative translator for the toast (it is stable across renders, unlike the reactive
`useT()` result, so the paste effect does not re-subscribe on every hover). Change the i18n import
(line 24) from:

```ts
import { useT } from '../i18n'
```

to:

```ts
import { t as translateNow, useT } from '../i18n'
```

Add these inside the component after `getDetailImage` (from Task 6):

```ts
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
```

Add the paste listener effect (after the Esc effect from Task 6):

```ts
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
```

- [ ] **Step 7: Hit-test the image on pointer down**

Replace the detail-mode guard added in Task 6 Step 9 (the `if (detailEditing) { return }` block
in `onPointerDown`) with image hit-testing that starts a `detailImage` drag:

```ts
    if (detailEditing) {
      if (currentDetail?.image && currentDetail.transform) {
        const img = getDetailImage(currentDetail.image)
        if (img) {
          const s = viewport.scale * currentDetail.transform.scale
          const cx = currentDetail.transform.x + (img.naturalWidth * currentDetail.transform.scale) / 2
          const cy = currentDetail.transform.y - (img.naturalHeight * currentDetail.transform.scale) / 2
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
```

- [ ] **Step 8: Move the image during a detailImage drag**

In `onPointerMove`, after the existing `if (drag.kind === 'label' ...)` block (around line 823) and
before the closing brace of `onPointerMove`, add:

```ts
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
```

(`onPointerUp` already runs `setDrag(null)` + `endInteraction()`, committing the move to the undo
stack — no change needed there.)

- [ ] **Step 9: Scale / rotate on wheel in detail mode**

In `onWheel`, at the very top of the handler (before the existing `const scroll = ...` line,
around line 852), add the detail-mode branch. It batches a scroll burst into a single undo entry
via a trailing timer:

```ts
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
        scaleDetailAboutCursor(currentDetail.transform, img.naturalWidth, img.naturalHeight, cursor, factor)
      )
      return
    }
```

- [ ] **Step 10: Add the "Add image…" button and hidden file input to the toolbar**

In the detail toolbar JSX (added in Task 6 Step 10), add the hidden file input and the
**Add image…** button before the **Remove image** button. The toolbar becomes:

```tsx
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
```

- [ ] **Step 11: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 12: Manual verification**

Run: `npm run dev`
Click-path:
1. Open a PDF with a facility + stores; Inspector → Detail pages → check row → **Edit** (detail mode).
2. Copy an image to the clipboard (e.g. a screenshot) and press Ctrl/Cmd+V over the stage.
Expected observations:
- The pasted image appears under the polygons at ~90% opacity, centered on the facility and
  scaled to fit its bbox, unrotated. **Remove image** now shows in the toolbar.
- Dragging anywhere on the image moves it (polygons stay put; the image slides under them).
- Scrolling the wheel over the image scales it about the cursor — the image point under the
  cursor stays put on screen.
- Shift+scroll rotates the image about its center in 0.5° steps.
- Clicking **Add image…** opens a file picker; choosing a PNG/JPEG places it the same way
  (JPEG is converted to PNG on import). A very large image is downscaled (max dimension 2000 px).
- Pasting when the clipboard has no image shows the `No image on the clipboard` /
  `クリップボードに画像がありません` toast and changes nothing.
- **Remove image** clears the image (polygons remain, vector-only). Undo (Ctrl/Cmd+Z) reverts the
  last move/scale/rotate as a single step.

- [ ] **Step 13: Run the PdfStage unit tests**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts`
Expected: PASS (all `detailFrame`, `inverseImagePoint`, `pointInImageRect`,
`scaleDetailAboutCursor`, and pre-existing helper suites).

- [ ] **Step 14: Commit**

```bash
git add src/renderer/src/components/PdfStage.tsx src/renderer/src/components/PdfStage.spec.ts
git commit -m "feat: add detail image paste, file import, and align interactions"
```

### Task 8: Detail header PNG strip (`report/detailHeader.ts`)

**Files:**
- Create: `src/renderer/src/report/detailHeader.ts`
- Test: `src/renderer/src/report/detailHeader.spec.ts`

**Interfaces:**
- Consumes: `REPORT_FONT_FAMILY` from `./legendLayout` (existing export).
- Produces:
  ```ts
  export interface DetailHeaderPng {
    png: Uint8Array
    width: number // CSS px (= PDF points when embedded 1:1)
    height: number
  }
  export function renderDetailHeaderPng(name: string, level: string): Promise<DetailHeaderPng>
  ```
  A canvas-rendered white strip: bold facility `name`, a ` · ` separator, then `level` in a lighter weight/color. CJK-safe (uses `REPORT_FONT_FAMILY`), dpr 2, mirroring `legendImage.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/report/detailHeader.spec.ts`. This mirrors `legendImage.spec.ts`: a stubbed canvas whose `measureText` returns a width proportional to the text length, collecting every `fillText` call so we can assert the composed strip contains both the name and the level.

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderDetailHeaderPng } from './detailHeader'

// Canvas stub: measureText width scales with text length; fillText calls are
// collected so we can assert the strip drew both the name and the level.
function setupCanvas(): { drawnText: string[] } {
  const drawnText: string[] = []
  const ctx = {
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn((text: string) => drawnText.push(text)),
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
    set lineWidth(_v: number) {}
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' }))
    )
  }
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
  return { drawnText }
}

describe('renderDetailHeaderPng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders a non-empty PNG strip with plausible dimensions', async () => {
    const { drawnText } = setupCanvas()

    const out = await renderDetailHeaderPng('エスパル仙台本館', '1F')

    expect(out.png.length).toBeGreaterThan(0)
    expect(out.width).toBeGreaterThan(0)
    expect(out.height).toBeGreaterThan(0)
    // A header is a wide, short strip.
    expect(out.width).toBeGreaterThan(out.height)
    expect(drawnText).toContain('エスパル仙台本館')
    expect(drawnText.some((s) => s.includes('1F'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/report/detailHeader.spec.ts`
Expected: FAIL — cannot resolve `./detailHeader` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/report/detailHeader.ts`:

```ts
import { REPORT_FONT_FAMILY } from './legendLayout'

const FONT_FAMILY = REPORT_FONT_FAMILY
const NAME_SIZE = 15 // px, bold facility name
const LEVEL_SIZE = 13 // px, level label
const PAD_X = 12
const PAD_Y = 8
const SEP = ' · '

export interface DetailHeaderPng {
  png: Uint8Array
  width: number // CSS px (= PDF points when embedded 1:1)
  height: number
}

export async function renderDetailHeaderPng(
  name: string,
  level: string
): Promise<DetailHeaderPng> {
  const dpr = 2
  const canvas = document.createElement('canvas')
  const measureCtx = canvas.getContext('2d')
  if (!measureCtx) throw new Error('Canvas 2D context unavailable')

  measureCtx.font = `bold ${NAME_SIZE}px ${FONT_FAMILY}`
  const nameW = measureCtx.measureText(name).width
  measureCtx.font = `${LEVEL_SIZE}px ${FONT_FAMILY}`
  const tailW = measureCtx.measureText(`${SEP}${level}`).width

  const width = Math.ceil(PAD_X * 2 + nameW + tailW)
  const height = PAD_Y * 2 + NAME_SIZE + 4

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

  const midY = height / 2
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#111827'
  ctx.font = `bold ${NAME_SIZE}px ${FONT_FAMILY}`
  ctx.fillText(name, PAD_X, midY)
  ctx.fillStyle = '#4b5563'
  ctx.font = `${LEVEL_SIZE}px ${FONT_FAMILY}`
  ctx.fillText(`${SEP}${level}`, PAD_X + nameW, midY)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('PNG rendering failed'))),
      'image/png'
    )
  })
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/report/detailHeader.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/report/detailHeader.ts src/renderer/src/report/detailHeader.spec.ts
git commit -m "feat: render detail-page header PNG strip"
```

---

### Task 9: Detail pages in `buildReportPdf` (`report/buildReport.ts`)

**Files:**
- Modify: `src/renderer/src/report/buildReport.ts`
- Test: `src/renderer/src/report/buildReport.spec.ts`

**Interfaces:**
- Consumes:
  - `facilityDetailBBox(areas: Area[], name: string, pageIndex: number): BBox | null` and
    `detailFit(bbox: BBox, avail: { width: number; height: number }): { scale: number; offsetX: number; offsetY: number }`
    from `../geometry/detailFit` (Task 1–4). `BBox = { x, y, w, h }` in PDF points, bottom-left origin.
    `detailFit` pads the bbox 5% each side, uniform-fits it into `avail`, and centers it;
    `offsetX/offsetY` are **centering-only, avail-local** (origin at `avail`'s bottom-left, y-up, no flip),
    so a source point maps into avail-local coords via
    `tx = (p.x - (bbox.x - 0.05*bbox.w)) * scale + offsetX` (y likewise).
  - `renderDetailHeaderPng(name, level): Promise<{ png, width, height }>` from `./detailHeader` (Task 8).
  - `DetailPage`, `DetailTransform` from `../state/types` (Task 1): `DetailTransform` = `{ x, y, scale, rotation }`
    where `x,y` is the image's **top-left** corner (visual top = max y) in source-page PDF points,
    `scale` = PDF points per image pixel, `rotation` = degrees **clockwise-positive** as applied on the
    y-down editing canvas (confirmed with the canvas/UI slice).
- Produces:
  ```ts
  export interface DetailOptions {
    pages: DetailPage[] // caller passes pre-sorted (facility order, then page); order preserved
    areas: Area[]
    pageLabels: string[] // indexed by pageIndex
  }
  // buildReportPdf gains a trailing optional param: detail?: DetailOptions
  ```
  Detail pages are inserted after `drawLegends` and before the summary-table page: one A4 page per
  `DetailPage`, landscape when the facility bbox is wider than tall, else portrait.

- [ ] **Step 1: Write the failing tests**

Replace `src/renderer/src/report/buildReport.spec.ts` with the following. The three existing tests are
kept verbatim; a new `describe('buildReportPdf detail pages')` block is added. The vitest `node` env has
no DOM, so the detail-header canvas is stubbed (mirroring `legendImage.spec.ts`); its `toBlob` returns a
real 1×1 PNG so `doc.embedPng` accepts the header bytes.

```ts
import { PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Area, DetailPage } from '../state/types'

import { buildReportPdf } from './buildReport'
import { detailFit } from '../geometry/detailFit'

const onePixelPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3, 253,
  167, 121, 129, 252, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
])
const onePixelBase64 = Buffer.from(onePixelPng).toString('base64')

// The detail header renders through a canvas; the vitest 'node' env has no DOM,
// so stub `document` like legendImage.spec does. toBlob yields a REAL 1x1 PNG so
// pdf-lib's embedPng accepts the header bytes.
function stubHeaderCanvas(): void {
  const ctx = {
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
    set lineWidth(_v: number) {}
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((cb: BlobCallback) => cb(new Blob([onePixelPng], { type: 'image/png' })))
  }
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
}

const wideFacility: Area = {
  id: 'wide',
  pageIndex: 0,
  kind: 'facility',
  name: 'エスパル仙台本館',
  polygon: [
    { x: 10, y: 10 },
    { x: 310, y: 10 },
    { x: 310, y: 110 },
    { x: 10, y: 110 }
  ]
}
const tallFacility: Area = {
  id: 'tall',
  pageIndex: 0,
  kind: 'facility',
  name: 'AER',
  polygon: [
    { x: 10, y: 10 },
    { x: 110, y: 10 },
    { x: 110, y: 310 },
    { x: 10, y: 310 }
  ]
}

describe('buildReportPdf', () => {
  it('appends an A4 portrait report page without replacing source pages', async () => {
    const source = await PDFDocument.create()
    source.addPage([200, 100])
    source.addPage([300, 150])

    const out = await buildReportPdf(await source.save(), onePixelPng)
    const doc = await PDFDocument.load(out)
    const pages = doc.getPages()

    expect(pages).toHaveLength(3)
    expect(pages[0].getWidth()).toBe(200)
    expect(pages[1].getWidth()).toBe(300)
    expect(pages[2].getWidth()).toBeCloseTo(595.28)
    expect(pages[2].getHeight()).toBeCloseTo(841.89)
  })

  it('draws traced area overlays onto source pages before appending the summary', async () => {
    const source = await PDFDocument.create()
    source.addPage([300, 300])
    const originalBytes = await source.save()
    const area: Area = {
      id: 'area-1',
      pageIndex: 0,
      kind: 'facility',
      name: 'エスパル仙台本館',
      polygon: [
        { x: 20, y: 20 },
        { x: 200, y: 20 },
        { x: 200, y: 160 },
        { x: 20, y: 160 }
      ]
    }

    const withoutOverlay = await buildReportPdf(originalBytes, onePixelPng)
    const withOverlay = await buildReportPdf(originalBytes, onePixelPng, [area])

    expect(withOverlay.length).toBeGreaterThan(withoutOverlay.length)
    expect((await PDFDocument.load(withOverlay)).getPageCount()).toBe(2)
  })

  it('labels store polygons with their code on the source pages', async () => {
    const source = await PDFDocument.create()
    source.addPage([300, 300])
    const originalBytes = await source.save()
    const polygon = [
      { x: 20, y: 20 },
      { x: 120, y: 20 },
      { x: 120, y: 120 },
      { x: 20, y: 120 }
    ]
    const withCode: Area = {
      id: 's',
      pageIndex: 0,
      kind: 'store',
      name: 'A',
      code: 'ts001',
      polygon
    }
    const withoutCode: Area = { id: 's', pageIndex: 0, kind: 'store', name: 'A', polygon }

    const labeled = await buildReportPdf(originalBytes, onePixelPng, [withCode])
    const unlabeled = await buildReportPdf(originalBytes, onePixelPng, [withoutCode])

    // The drawn code text adds content the code-less store does not.
    expect(labeled.length).toBeGreaterThan(unlabeled.length)
  })
})

describe('buildReportPdf detail pages', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('inserts detail pages between the originals and the summary, preserving input order', async () => {
    stubHeaderCanvas()
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const detail = {
      pages: [
        { name: 'エスパル仙台本館', pageIndex: 0 },
        { name: 'AER', pageIndex: 0 }
      ] as DetailPage[],
      areas: [wideFacility, tallFacility],
      pageLabels: ['1F']
    }

    const out = await buildReportPdf(
      await source.save(),
      onePixelPng,
      [],
      {},
      undefined,
      undefined,
      detail
    )
    const pages = (await PDFDocument.load(out)).getPages()

    // 1 original + 2 detail + 1 summary table.
    expect(pages).toHaveLength(4)
    // Order preserved: wide facility (landscape) then tall facility (portrait).
    expect(pages[1].getWidth()).toBeCloseTo(841.89)
    expect(pages[1].getHeight()).toBeCloseTo(595.28)
    expect(pages[2].getWidth()).toBeCloseTo(595.28)
    expect(pages[2].getHeight()).toBeCloseTo(841.89)
    // Summary table stays last, A4 portrait.
    expect(pages[3].getWidth()).toBeCloseTo(595.28)
    expect(pages[3].getHeight()).toBeCloseTo(841.89)
  })

  it('orients a detail page landscape when its facility bbox is wider than tall', async () => {
    stubHeaderCanvas()
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const detail = {
      pages: [{ name: 'エスパル仙台本館', pageIndex: 0 }] as DetailPage[],
      areas: [wideFacility],
      pageLabels: ['1F']
    }

    const pages = (
      await PDFDocument.load(
        await buildReportPdf(await source.save(), onePixelPng, [], {}, undefined, undefined, detail)
      )
    ).getPages()

    expect(pages[1].getWidth()).toBeGreaterThan(pages[1].getHeight())
  })

  it('skips detail entries whose facility has no polygons on the page', async () => {
    stubHeaderCanvas()
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const detail = {
      pages: [{ name: '存在しない施設', pageIndex: 0 }] as DetailPage[],
      areas: [wideFacility],
      pageLabels: ['1F']
    }

    const pages = (
      await PDFDocument.load(
        await buildReportPdf(await source.save(), onePixelPng, [], {}, undefined, undefined, detail)
      )
    ).getPages()

    // No detail page added: 1 original + 1 summary.
    expect(pages).toHaveLength(2)
  })

  it('renders a vector-only detail page when the entry has no image', async () => {
    stubHeaderCanvas()
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const detail = {
      pages: [{ name: 'エスパル仙台本館', pageIndex: 0 }] as DetailPage[],
      areas: [wideFacility],
      pageLabels: ['1F']
    }

    const pages = (
      await PDFDocument.load(
        await buildReportPdf(await source.save(), onePixelPng, [], {}, undefined, undefined, detail)
      )
    ).getPages()

    // 1 original + 1 detail (no image) + 1 summary.
    expect(pages).toHaveLength(3)
  })

  it('embeds the background image when the entry has one', async () => {
    stubHeaderCanvas()
    const source = await PDFDocument.create()
    source.addPage([400, 400])
    const originalBytes = await source.save()
    const base = {
      pages: [{ name: 'エスパル仙台本館', pageIndex: 0 }] as DetailPage[],
      areas: [wideFacility],
      pageLabels: ['1F']
    }
    const withImage = {
      ...base,
      pages: [
        {
          name: 'エスパル仙台本館',
          pageIndex: 0,
          image: onePixelBase64,
          transform: { x: 20, y: 100, scale: 2, rotation: 15 }
        }
      ] as DetailPage[]
    }

    const noImg = await buildReportPdf(
      originalBytes,
      onePixelPng,
      [],
      {},
      undefined,
      undefined,
      base
    )
    stubHeaderCanvas()
    const img = await buildReportPdf(
      originalBytes,
      onePixelPng,
      [],
      {},
      undefined,
      undefined,
      withImage
    )

    // The embedded background adds content the vector-only page lacks.
    expect(img.length).toBeGreaterThan(noImg.length)
  })

  it('centers the padded facility bbox in the content area (detailFit contract)', () => {
    const bbox = { x: 100, y: 200, w: 300, h: 100 }
    const avail = { width: 500, height: 400 }
    const fit = detailFit(bbox, avail)
    const padX = bbox.w * 0.05
    const padY = bbox.h * 0.05
    // The mapping the export applies (avail-local, before the content-area shift):
    const map = (p: { x: number; y: number }): { x: number; y: number } => ({
      x: (p.x - (bbox.x - padX)) * fit.scale + fit.offsetX,
      y: (p.y - (bbox.y - padY)) * fit.scale + fit.offsetY
    })
    const center = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }
    const mapped = map(center)
    expect(mapped.x).toBeCloseTo(avail.width / 2)
    expect(mapped.y).toBeCloseTo(avail.height / 2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/report/buildReport.spec.ts`
Expected: FAIL — either the import of `../geometry/detailFit` cannot resolve (if Task 1–4 not yet done)
or, once it resolves, the `detail pages` block fails because `buildReportPdf` ignores the 7th argument
(page counts are `1`/`2` instead of `4`/`3`, orientation assertions fail). The three original tests still PASS.

- [ ] **Step 3: Write the implementation**

Replace `src/renderer/src/report/buildReport.ts` with the following. Changes vs. the original:
`degrees` and `PDFPage` are imported from `pdf-lib`; `DetailPage` is imported from types; `detailFit` +
`facilityDetailBBox` from geometry and `renderDetailHeaderPng` from `./detailHeader` are imported;
`svgPath`/`centroid` are typed to `Pt[]`; `drawAreaOverlays` gains `targetPage` and `mapPt` params and
scales the store-code size by the mapper's zoom; a new `drawDetailPages` helper + `DetailOptions` export
are added; `buildReportPdf` gains the trailing `detail?` param and calls `drawDetailPages` after legends.

```ts
import {
  PDFDocument,
  degrees,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage,
  type RGB
} from 'pdf-lib'

import type {
  Area,
  DetailPage,
  LegendEntry,
  LegendOrientation,
  Pt,
  StoreLabelMode
} from '../state/types'
import { storeTagLabel } from '../state/storeLabel'
import { colorForName } from '../utils/colors'
import { detailFit, facilityDetailBBox } from '../geometry/detailFit'
import { renderDetailHeaderPng } from './detailHeader'
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

function svgPath(points: Pt[]): string {
  return `${points.map((pt, index) => `${index === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ')} Z`
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
  mapPt: (pt: Pt) => Pt = (p) => p
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
    const page = targetPage ?? pages[area.pageIndex]
    if (!page || area.polygon.length < 3) continue
    const color = overlayColor(area.name, colors)
    const holePaths = (area.holes ?? [])
      .filter((ring) => ring.length >= 3)
      .map((ring) => svgPath([...ring].reverse().map(mapPt)))
      .join(' ')
    const mapped = area.polygon.map(mapPt)
    const overlayPath = holePaths ? `${svgPath(mapped)} ${holePaths}` : svgPath(mapped)
    page.drawSvgPath(overlayPath, {
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

async function drawLegends(doc: PDFDocument, legend: LegendOptions): Promise<void> {
  if (!legend.visible) return
  const pages = doc.getPages()
  for (let i = 0; i < pages.length; i += 1) {
    const entries = legend.entriesForPage(i)
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
}

const A4_SHORT = 595.28
const A4_LONG = 841.89
const DETAIL_MARGIN = 28
const DETAIL_HEADER_GAP = 10

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

    // Header band across the top; embed it now (need its height for the layout)
    // but draw it LAST so it sits above everything in the top band.
    const level = detail.pageLabels[dp.pageIndex] ?? `Page ${dp.pageIndex + 1}`
    const header = await renderDetailHeaderPng(dp.name, level)
    const headerImg = await doc.embedPng(header.png)

    // Content area = page minus margins minus the header band. Its bottom-left
    // in page space is (DETAIL_MARGIN, DETAIL_MARGIN); it sits below the header.
    const contentX = DETAIL_MARGIN
    const contentY = DETAIL_MARGIN
    const contentW = pageW - DETAIL_MARGIN * 2
    const contentH = pageH - DETAIL_MARGIN * 2 - header.height - DETAIL_HEADER_GAP
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
      page.drawImage(embed, { x: ax, y: ay, width: w, height: h, rotate: degrees(phi) })
    }

    // 2) Facility + store overlays for this facility/page, mapped through the fit.
    const facilityAreas = detail.areas.filter(
      (a) => a.name === dp.name && a.pageIndex === dp.pageIndex
    )
    drawAreaOverlays(doc, facilityAreas, colors, codeFont, storeLabels, page, mapPt)

    // 3) Header last, on top of the content.
    page.drawImage(headerImg, {
      x: DETAIL_MARGIN,
      y: pageH - DETAIL_MARGIN - header.height,
      width: header.width,
      height: header.height
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
  detail?: DetailOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes)
  const codeFont = await doc.embedFont(StandardFonts.Helvetica)
  drawAreaOverlays(doc, areas, colors, codeFont, storeLabels)
  if (legend) await drawLegends(doc, legend)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/report/buildReport.spec.ts`
Expected: PASS (3 original + 6 detail-page tests = 9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/report/buildReport.ts src/renderer/src/report/buildReport.spec.ts
git commit -m "feat: render facility detail pages in the exported report"
```

---

### Task 10: Wire detail pages into report generation (`App.tsx`)

**Files:**
- Modify: `src/renderer/src/App.tsx` (the `buildReportPdf(...)` call inside `generateReport`, ~lines 200–215)

**Interfaces:**
- Consumes: `buildReportPdf(..., detail?: DetailOptions)` from Task 9 (`DetailOptions = { pages, areas, pageLabels }`);
  `AppState.detailPages: DetailPage[]`, `AppState.names: string[]`, `AppState.pages: PageState[]` (`PageState.label`)
  from Task 1. This task touches ONLY the report-generation call site; detail-mode UI wiring lives in the canvas/UI slice.

- [ ] **Step 1: Update the report call site**

In `src/renderer/src/App.tsx`, inside the `generateReport` callback, replace the block that computes
`png` and calls `buildReportPdf` (currently lines ~200–215) with the following. It sorts the enabled
detail pages into facility order (per `state.names`) then page order, and passes them as the new `detail`
argument along with the areas and per-page labels:

```ts
      const title = `面積集計 — ${state.fileName ?? 'PDF'}`
      const png = await renderReportPng(state, title)
      const detailPages = [...state.detailPages].sort(
        (a, b) =>
          state.names.indexOf(a.name) - state.names.indexOf(b.name) || a.pageIndex - b.pageIndex
      )
      const pdf = await buildReportPdf(
        state.originalBytes,
        png,
        state.areas,
        state.colors,
        {
          visible: state.legendVisible,
          pos: state.legendPos,
          entriesForPage: (pageIndex) => facilitiesOnPage(state, pageIndex),
          orientation: state.legendOrientation,
          scale: state.legendScale
        },
        { mode: state.storeLabelMode, prefixes: state.prefixes },
        {
          pages: detailPages,
          areas: state.areas,
          pageLabels: state.pages.map((p) => p.label)
        }
      )
```

No change is needed to `buildReport.spec.ts`: `detail` is a trailing optional argument, so the existing
call sites remain valid, and the detail behaviour is already covered by the Task 9 tests.

- [ ] **Step 2: Typecheck gate**

Run: `npm run typecheck`
Expected: no errors. (The renderer is covered by `typecheck:web`; the new `detail` argument, `state.detailPages`,
`state.names`, and `state.pages` all type-check against Task 1's `AppState` and Task 9's `DetailOptions`.)

- [ ] **Step 3: Focused test run**

Run: `npx vitest run src/renderer/src/report/buildReport.spec.ts`
Expected: PASS (9 tests) — confirms the report builder still behaves with the wired `detail` shape.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: pass enabled detail pages to the report export"
```
