# Copy/Paste Areas + Drag-to-Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users copy the selected area or a whole page of areas and paste them onto another page at identical coordinates, and drag a whole area to reposition it (Edit tool, Shift locks the axis).

**Architecture:** A session-only `clipboard` on the zustand store holds copied `{ name, polygon }` records. New store actions perform copy/paste and whole-polygon translation. `PdfStage` gains an `'area'` drag mode in the Edit tool. `App` wires `Ctrl/Cmd+C` / `Ctrl/Cmd+V`; `Sidebar` adds Copy/Paste buttons.

**Tech Stack:** Electron + React 19 + TypeScript, zustand (vanilla store), Vitest.

## Global Constraints

- Test runner: `npx vitest run <path>` (there is no `test` npm script).
- Renderer typecheck: `npm run typecheck:web` (must stay clean).
- The clipboard is **session-only**: it is on `AppState` but MUST NOT be added to
  `ProjectFile`, `importProject`, or `saveProject`.
- Polygons are in PDF point-space (`Pt = { x, y }`); always **deep-clone**
  polygons when copying/pasting so edits never alias the clipboard or source.
- The working directory is **not a git repository**. "Checkpoint" steps below
  replace commits: run the listed tests + typecheck and confirm green. If you
  run `git init` first, replace each Checkpoint with a real `git add`/`commit`.

---

### Task 1: Store — clipboard state + copy actions

**Files:**
- Modify: `src/renderer/src/state/types.ts` (add `CopiedArea`, add `clipboard` to `AppState`)
- Modify: `src/renderer/src/state/store.ts` (interface, `initialState`, two actions)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Consumes: existing `Area`, `Pt`, `AppState`, `createAreaStore`, module-level `withName`/`withNameColor`.
- Produces:
  - `interface CopiedArea { name: string; polygon: Pt[] }`
  - `AppState.clipboard: CopiedArea[]`
  - `copySelectedArea(): number` — copies the selected area (0 or 1).
  - `copyActivePage(): number` — copies all areas on `activePageIndex` (count; clipboard unchanged when 0).

- [ ] **Step 1: Add the `CopiedArea` type and `clipboard` field**

In `src/renderer/src/state/types.ts`, add the interface just above `export interface ProjectFile`:

```ts
export interface CopiedArea {
  name: string
  polygon: Pt[]
}
```

Then add `clipboard` to `AppState` (place it after `colors: Record<string, string>`):

```ts
  clipboard: CopiedArea[]
```

- [ ] **Step 2: Declare the actions on the store interface**

In `src/renderer/src/state/store.ts`, import `CopiedArea` in the existing type import:

```ts
import type { AppState, Area, CopiedArea, PageState, Pt, ReportRow, ScaleMode, Tool } from './types'
```

Add to the `AreaStore` interface (after `importProject(...)`):

```ts
  copySelectedArea(): number
  copyActivePage(): number
```

Add `clipboard: []` to `initialState` (after `pan: { x: 0, y: 0 }` — add a comma):

```ts
  pan: { x: 0, y: 0 },
  clipboard: []
```

- [ ] **Step 3: Write the failing tests**

Add to `src/renderer/src/state/store.spec.ts` inside `describe('area store', ...)`:

```ts
  it('copies the selected area and nothing when no selection', () => {
    const a = square(0, 'A')
    const store = createAreaStore({ pages, names: ['A'], areas: [a], selectedAreaId: a.id })

    expect(store.getState().copySelectedArea()).toBe(1)
    expect(store.getState().clipboard).toEqual([{ name: 'A', polygon: a.polygon }])

    store.getState().selectArea(null)
    expect(store.getState().copySelectedArea()).toBe(0)
  })

  it('copies every area on the active page', () => {
    const store = createAreaStore({
      pages,
      names: ['A', 'B'],
      areas: [square(0, 'A'), square(1, 'B'), square(0, 'A')],
      activePageIndex: 0
    })

    expect(store.getState().copyActivePage()).toBe(2)
    expect(store.getState().clipboard.map((c) => c.name)).toEqual(['A', 'A'])

    store.getState().setActivePage(1)
    // page 1 has one area 'B'
    expect(store.getState().copyActivePage()).toBe(1)
  })
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: FAIL — `copySelectedArea` / `copyActivePage` is not a function.

- [ ] **Step 5: Implement the two actions**

In `src/renderer/src/state/store.ts`, add inside the object returned by `createStore`, after the `importProject(project) { ... }` block (add a comma after `importProject`'s closing brace):

```ts
    copySelectedArea() {
      const state = get()
      const area = state.areas.find((candidate) => candidate.id === state.selectedAreaId)
      if (!area) return 0
      set({ clipboard: [{ name: area.name, polygon: area.polygon.map((pt) => ({ ...pt })) }] })
      return 1
    },

    copyActivePage() {
      const state = get()
      const onPage = state.areas.filter((area) => area.pageIndex === state.activePageIndex)
      if (onPage.length === 0) return 0
      set({ clipboard: onPage.map((area) => ({ name: area.name, polygon: area.polygon.map((pt) => ({ ...pt })) })) })
      return onPage.length
    },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 7: Checkpoint**

Run: `npm run typecheck:web`
Expected: no output (clean). Confirm the store spec is green.

---

### Task 2: Store — paste + setAreaPolygon

**Files:**
- Modify: `src/renderer/src/state/store.ts` (interface + two actions)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Consumes: `clipboard`, `activePageIndex`, `withName`, `withNameColor`, `crypto.randomUUID`.
- Produces:
  - `pasteClipboard(): number` — appends one new `Area` per clipboard entry on `activePageIndex`, fresh `id`, registers names/colors, selects the last pasted area; returns count (0 if empty).
  - `setAreaPolygon(id: string, polygon: Pt[]): void` — replaces the polygon of the area with `id`; no-op if unknown.

- [ ] **Step 1: Declare the actions on the store interface**

In `src/renderer/src/state/store.ts`, add to the `AreaStore` interface (after `copyActivePage(): number`):

```ts
  pasteClipboard(): number
  setAreaPolygon(id: string, polygon: Pt[]): void
```

- [ ] **Step 2: Write the failing tests**

Add to `src/renderer/src/state/store.spec.ts` inside `describe('area store', ...)`:

```ts
  it('pastes clipboard areas onto the active page with fresh ids and selection', () => {
    const a = square(0, 'A')
    const store = createAreaStore({ pages, names: ['A'], areas: [a], selectedAreaId: a.id })
    store.getState().copySelectedArea()

    store.getState().setActivePage(1)
    expect(store.getState().pasteClipboard()).toBe(1)

    const pasted = store.getState().areas.find((area) => area.pageIndex === 1 && area.name === 'A')
    expect(pasted).toBeTruthy()
    expect(pasted!.id).not.toBe(a.id)
    expect(pasted!.polygon).toEqual(a.polygon)
    expect(store.getState().selectedAreaId).toBe(pasted!.id)

    // pasted polygon is an independent clone
    store.getState().setAreaPolygon(pasted!.id, [{ x: 99, y: 99 }, { x: 1, y: 0 }, { x: 0, y: 1 }])
    expect(store.getState().clipboard[0].polygon).toEqual(a.polygon)
    expect(store.getState().areas.find((area) => area.id === a.id)!.polygon).toEqual(a.polygon)
  })

  it('registers pasted names and returns 0 on empty clipboard', () => {
    const store = createAreaStore({ pages, names: [], areas: [], activePageIndex: 0 })
    expect(store.getState().pasteClipboard()).toBe(0)

    store.getState().importProject({ pages, names: ['X'], areas: [square(0, 'X')] })
    store.getState().copyActivePage()
    store.getState().pasteClipboard()
    expect(store.getState().names).toContain('X')
    expect(colorForBusiness(store.getState(), 'X')).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('setAreaPolygon replaces the target polygon and ignores unknown ids', () => {
    const a = square(0, 'A')
    const store = createAreaStore({ pages, names: ['A'], areas: [a] })
    const next = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]

    store.getState().setAreaPolygon(a.id, next)
    expect(store.getState().areas[0].polygon).toEqual(next)

    store.getState().setAreaPolygon('missing', [{ x: 0, y: 0 }])
    expect(store.getState().areas[0].polygon).toEqual(next)
  })
```

Note: `colorForBusiness` is already imported at the top of the spec.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: FAIL — `pasteClipboard` / `setAreaPolygon` is not a function.

- [ ] **Step 4: Implement the two actions**

In `src/renderer/src/state/store.ts`, add after the `copyActivePage()` block (comma after it):

```ts
    pasteClipboard() {
      const state = get()
      if (state.clipboard.length === 0) return 0
      const pageIndex = state.activePageIndex
      const pasted: Area[] = state.clipboard.map((copied) => ({
        id: crypto.randomUUID(),
        pageIndex,
        name: copied.name,
        polygon: copied.polygon.map((pt) => ({ ...pt }))
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Checkpoint**

Run: `npm run typecheck:web`
Expected: clean.

---

### Task 3: PdfStage — drag-to-move whole area (Edit tool, Shift axis-lock)

**Files:**
- Modify: `src/renderer/src/components/PdfStage.tsx` (`constrainDelta` helper, `DragState`, store hook, pointer down/move)
- Test: `src/renderer/src/components/PdfStage.spec.ts`

**Interfaces:**
- Consumes: `setAreaPolygon(id, polygon)` from the store (Task 2), existing `findAreaAt`, `eventToPdfPt`, `selectArea`, `pan`, `selectedAreaId`, `Pt`.
- Produces: `export function constrainDelta(delta: Pt, lockAxis: boolean): Pt`.

- [ ] **Step 1: Write the failing test for the axis-lock helper**

Add to `src/renderer/src/components/PdfStage.spec.ts`:

```ts
import { anchoredZoomScroll, constrainDelta, shouldPanPointer } from './PdfStage'
```

(replace the existing import line) and add this test inside the `describe`:

```ts
  it('locks drag to the dominant axis when requested', () => {
    expect(constrainDelta({ x: 5, y: 2 }, false)).toEqual({ x: 5, y: 2 })
    expect(constrainDelta({ x: 5, y: 2 }, true)).toEqual({ x: 5, y: 0 })
    expect(constrainDelta({ x: 2, y: 5 }, true)).toEqual({ x: 0, y: 5 })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts`
Expected: FAIL — `constrainDelta` is not exported.

- [ ] **Step 3: Add the helper**

In `src/renderer/src/components/PdfStage.tsx`, add near the other exported helpers (e.g. after `shouldPanPointer`):

```ts
export function constrainDelta(delta: Pt, lockAxis: boolean): Pt {
  if (!lockAxis) return delta
  return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts`
Expected: PASS.

- [ ] **Step 5: Extend `DragState` and pull in the store action**

In `src/renderer/src/components/PdfStage.tsx`, change the `DragState` interface to:

```ts
interface DragState {
  kind: 'pan' | 'vertex' | 'area'
  startClient: Pt
  startPan: Pt
  areaId?: string
  vertexIndex?: number
  startPt?: Pt
  startPolygon?: Pt[]
  moved: boolean
}
```

Add the store hook alongside the other `useAreaStore` selectors (near `moveVertex`):

```ts
  const setAreaPolygon = useAreaStore((s) => s.setAreaPolygon)
```

- [ ] **Step 6: Start an area drag on Edit-tool body press**

In `onPointerDown`, inside the `if (tool === 'edit') { ... }` block, replace the final two lines:

```ts
      setSelectedVertex(null)
      return
    }
```

with:

```ts
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
      setSelectedVertex(null)
      return
    }
```

- [ ] **Step 7: Translate the polygon on move**

In `onPointerMove`, after the existing vertex block:

```ts
    if (drag.areaId && drag.vertexIndex != null) {
      moveVertex(drag.areaId, drag.vertexIndex, pdfPt)
      setDrag({ ...drag, moved })
    }
```

add:

```ts
    if (drag.kind === 'area' && drag.areaId && drag.startPt && drag.startPolygon) {
      const raw = { x: pdfPt.x - drag.startPt.x, y: pdfPt.y - drag.startPt.y }
      const delta = constrainDelta(raw, event.shiftKey)
      setAreaPolygon(
        drag.areaId,
        drag.startPolygon.map((pt) => ({ x: pt.x + delta.x, y: pt.y + delta.y }))
      )
      setDrag({ ...drag, moved })
    }
```

- [ ] **Step 8: Checkpoint**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts` (PASS)
Run: `npm run typecheck:web` (clean)
Manual: in `npm run dev`, open a multi-page PDF, draw an area, switch to Edit, drag the area body — it moves; holding Shift locks to one axis.

---

### Task 4: UI triggers — keyboard shortcuts + sidebar buttons + overlay rows

**Files:**
- Modify: `src/renderer/src/App.tsx` (keyboard handler, `shortcutRows`)
- Modify: `src/renderer/src/components/Sidebar.tsx` (Copy/Paste buttons)
- Modify: `src/renderer/src/assets/main.css` (small `.area-actions` layout rule)

**Interfaces:**
- Consumes: `copySelectedArea`, `copyActivePage`, `pasteClipboard`, `clipboard` from the store (Tasks 1–2); existing `showToast`, `areaStore`.
- Produces: no new exports; wires triggers to existing store actions.

- [ ] **Step 1: Add Ctrl/Cmd+C and Ctrl/Cmd+V to the global key handler**

In `src/renderer/src/App.tsx`, inside the `onKeyDown` in the main `useEffect`, add this block immediately after the space-key `if (event.key === ' ') { ... }` block and before `if (event.key === 'D' || event.key === 'd')`:

```ts
      if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
        event.preventDefault()
        const count = state.selectedAreaId ? state.copySelectedArea() : state.copyActivePage()
        showToast(count ? `Copied ${count} area${count === 1 ? '' : 's'}` : 'No areas to copy')
        return
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) {
        event.preventDefault()
        const count = state.pasteClipboard()
        showToast(count ? `Pasted ${count} area${count === 1 ? '' : 's'}` : 'Nothing to paste')
        return
      }
```

Then add `showToast` to that effect's dependency array so it reads `}, [shortcutsOpen, showToast])`.
(The existing top-of-handler guard already returns early for INPUT/SELECT/TEXTAREA on non-Escape keys, so native copy/paste inside text fields is unaffected.)

- [ ] **Step 2: Add rows to the shortcuts overlay**

In `src/renderer/src/App.tsx`, add to the `shortcutRows` array (before the closing `]`):

```ts
  ['Ctrl/Cmd + C', 'Copy selected area, or whole page if none selected'],
  ['Ctrl/Cmd + V', 'Paste areas onto the current page'],
  ['Drag area (Edit tool)', 'Move the whole area — hold Shift to lock the axis']
```

- [ ] **Step 3: Add Copy/Paste buttons to the Sidebar**

In `src/renderer/src/components/Sidebar.tsx`, in the "Areas on page" `<section>`, insert an actions row immediately after the `panel__header` `</div>` and before the `activePageAreas.length === 0 ? ...`:

```tsx
        <div className="area-actions">
          <button
            type="button"
            disabled={activePageAreas.length === 0}
            onClick={() => state.copyActivePage()}
          >
            Copy all
          </button>
          <button
            type="button"
            disabled={state.clipboard.length === 0}
            onClick={() => state.pasteClipboard()}
          >
            Paste
          </button>
        </div>
```

Then in the `selected` panel, add a Copy button just before the "Delete selected area" button:

```tsx
          <button type="button" onClick={() => state.copySelectedArea()}>
            Copy area
          </button>
```

(`state` here is the full store from `useAreaStore((s) => s)`, so `state.clipboard`, `state.copyActivePage`, `state.pasteClipboard`, and `state.copySelectedArea` are all available.)

- [ ] **Step 4: Style the actions row**

In `src/renderer/src/assets/main.css`, append:

```css
.area-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.area-actions button {
  flex: 1;
}
```

- [ ] **Step 5: Checkpoint**

Run: `npm run typecheck:web` (clean)
Run: `npx vitest run` (all specs PASS)
Manual in `npm run dev`:
- Select an area, press `Ctrl+C`, switch page, press `Ctrl+V` → the area appears at the same spot and is selected; toast shows counts.
- With nothing selected, `Ctrl+C` copies the whole page; `Ctrl+V` on another page reproduces every area aligned.
- Sidebar "Copy all" enables "Paste"; "Paste" adds the areas. "Copy area" in the selected panel copies one.
- Open the Shortcuts overlay → the three new rows are present.

---

## Notes for the implementer

- Do not add `clipboard` to `ProjectFile`, `importProject`, or `saveProject` — it
  is deliberately session-only. `loadDocument`'s `set({...})` shallow-merges, so
  the clipboard correctly survives opening a new document without any extra code.
- Keep the deep-clone (`polygon.map((pt) => ({ ...pt }))`) on every copy and
  paste; the store spec's independence test depends on it.
