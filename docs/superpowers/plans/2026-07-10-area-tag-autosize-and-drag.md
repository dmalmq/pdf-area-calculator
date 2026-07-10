# Auto-sized, Draggable Area Tags + Store-Tag Display Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-size each area's on-canvas tag to its text (long facility names stop overflowing), let the user drag tags off underlying content (persisted per area, Edit tool), and add a store-tag display mode (Code / Number / Off) that applies to both the canvas and the exported PDF.

**Architecture:** A per-area `labelOffset` (delta from centroid, PDF points) and an app-level `storeLabelMode` live on the model and persist through the existing save/load. A pure `storeTagLabel(code, prefix, mode)` derives what a store tag shows (full code, integer, or nothing) and is shared by the canvas overlay and the report. On the canvas, one `tagRect` helper (built on a pure `tagBoxSize`) drives drawing and hit-testing; dragging is wired into the Edit tool only. The export's in-place store code passes through the same `storeTagLabel`.

**Tech Stack:** TypeScript, React 19, Zustand, pdf.js (`PageViewport`), pdf-lib, canvas 2D, Vitest. Renderer code under `src/renderer/src`.

## Global Constraints

- **Store-tag mode applies to the canvas AND the export** (`buildReport.ts`). Default is `code`, so existing behavior and `buildReport.spec.ts` are unchanged.
- **Facility tags are unchanged by the mode** — always name + m². They are still auto-sized and draggable.
- **Moving a tag is on-canvas only** — the export always draws the store label at the polygon centroid.
- **No project-file version bump.** `labelOffset` and `storeLabelMode` are additive optional fields; `ProjectFile.version` stays `1 | 2`.
- **Tags stay a fixed screen size** (font `600 13px`); only box width/height become measured. `labelOffset` is stored in PDF points (tracks the page under zoom/pan) as a **delta from the centroid** (follows the polygon on move/reshape).
- **Number format** = integer, leading zeros dropped (`7`, not `007`).
- **Tag drag is Edit-tool-only**; Draw clicks keep placing vertices; legend drag keeps its priority. The report **summary page** (`report/reportImage.ts`) and `report/legendImage.ts` are NOT touched.
- Follow existing conventions: immutable Zustand `set((state) => ...)`; module-level pure helpers exported for tests; mode buttons mirror the legend Vertical/Horizontal pattern.

---

## File Structure

- `src/renderer/src/state/types.ts` — `Area.labelOffset?: Pt`; `StoreLabelMode`; `AppState.storeLabelMode`; `ProjectFile.storeLabelMode?`.
- `src/renderer/src/state/storeLabel.ts` — **new** leaf module: pure `storeTagLabel`.
- `src/renderer/src/state/store.ts` — `initialState.storeLabelMode`; `setAreaLabelOffset`, `setStoreLabelMode`; `importProject` mapping.
- `src/renderer/src/App.tsx` — `saveProject` (`storeLabelMode`); `generateReport` (store-label options).
- `src/renderer/src/components/PdfStage.tsx` — `TAG`, `tagBoxSize`, `tagLines`, `tagRect`, `findTagAt`; rewritten tag draw; `DragState` `'label'`; pointer/double-click wiring.
- `src/renderer/src/components/Toolbar.tsx` — "Store tags" Code/Number/Off group.
- `src/renderer/src/report/buildReport.ts` — `drawAreaOverlays` + `buildReportPdf` store-label option.
- Tests: `state/storeLabel.spec.ts` (new), `state/store.spec.ts`, `components/PdfStage.spec.ts`.

---

## Task 1: State + persistence

**Files:**

- Modify: `src/renderer/src/state/types.ts`
- Modify: `src/renderer/src/state/store.ts` (`AreaStore` interface ~line 61; `initialState` ~line 71-94; `importProject` ~line 464-489; new actions after `setAreaPolygon` ~line 556)
- Modify: `src/renderer/src/App.tsx` (`saveProject` `ProjectFile` literal ~line 72-85)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**

- Produces: `Area.labelOffset?: Pt`; `StoreLabelMode = 'code' | 'number' | 'off'`; `AppState.storeLabelMode: StoreLabelMode`; `AreaStore.setAreaLabelOffset(id: string, offset: Pt): void`; `AreaStore.setStoreLabelMode(mode: StoreLabelMode): void`.

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/src/state/store.spec.ts` (uses existing `pages`, `square`, `createAreaStore`):

```ts
it('sets a per-area label offset without touching other areas', () => {
  const a = square(0, 'A')
  const b = square(0, 'B')
  const store = createAreaStore({ areas: [a, b] })

  store.getState().setAreaLabelOffset(a.id, { x: 5, y: -3 })

  expect(store.getState().areas.find((area) => area.id === a.id)?.labelOffset).toEqual({
    x: 5,
    y: -3
  })
  expect(store.getState().areas.find((area) => area.id === b.id)?.labelOffset).toBeUndefined()
})

it('defaults and sets the store label mode', () => {
  const store = createAreaStore({})
  expect(store.getState().storeLabelMode).toBe('code')
  store.getState().setStoreLabelMode('number')
  expect(store.getState().storeLabelMode).toBe('number')
})

it('preserves labelOffset and storeLabelMode through importProject, with defaults', () => {
  const store = createAreaStore({})
  store.getState().importProject({
    pages,
    names: ['A'],
    areas: [
      {
        id: 'a1',
        pageIndex: 0,
        kind: 'facility',
        name: 'A',
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 }
        ],
        labelOffset: { x: 7, y: 8 }
      },
      {
        id: 'a2',
        pageIndex: 0,
        kind: 'facility',
        name: 'A',
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 }
        ]
      }
    ],
    storeLabelMode: 'number'
  })
  expect(store.getState().areas[0].labelOffset).toEqual({ x: 7, y: 8 })
  expect(store.getState().areas[1].labelOffset).toBeUndefined()
  expect(store.getState().storeLabelMode).toBe('number')

  store.getState().importProject({ pages, names: ['A'], areas: [] })
  expect(store.getState().storeLabelMode).toBe('code')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: FAIL — `setAreaLabelOffset`/`setStoreLabelMode` not functions; `storeLabelMode` undefined; type errors on `labelOffset`/`storeLabelMode` (red state).

- [ ] **Step 3: Extend `types.ts`**

Add the `Area.labelOffset` field (after `polygon: Pt[]`):

```ts
  polygon: Pt[] // vertices in PDF pt space
  labelOffset?: Pt // tag position as a delta from the centroid, in PDF points; absent = centroid
```

Add the mode type next to `LegendOrientation`:

```ts
export type StoreLabelMode = 'code' | 'number' | 'off'
```

Add to `interface AppState` (next to the legend fields):

```ts
storeLabelMode: StoreLabelMode
```

Add to `interface ProjectFile` (next to `legendOrientation?`):

```ts
  storeLabelMode?: StoreLabelMode
```

- [ ] **Step 4: Extend `store.ts`**

(a) Import the type — add `StoreLabelMode` to the `import type { … } from './types'` block.

(b) `initialState` — add next to `legendOrientation`:

```ts
  storeLabelMode: 'code',
```

(c) `AreaStore` interface — add after `setAreaPolygon(id: string, polygon: Pt[]): void`:

```ts
  setAreaLabelOffset(id: string, offset: Pt): void
  setStoreLabelMode(mode: StoreLabelMode): void
```

(d) `AreaStore.importProject` parameter object type — add:

```ts
    storeLabelMode?: StoreLabelMode
```

(the `areas` element type already carries optional `labelOffset` via `Omit<Area, 'kind'>`).

(e) `importProject` implementation — in the `project.areas.map((area) => ({ ... }))`, change the `polygon` line to add `labelOffset`, and add `storeLabelMode` next to the legend fields:

```ts
          polygon: area.polygon,
          labelOffset: area.labelOffset
```

```ts
        storeLabelMode: project.storeLabelMode ?? 'code',
```

(f) Implement the actions immediately after the `setAreaPolygon(id, polygon) { ... },` implementation:

```ts
    setAreaLabelOffset(id, offset) {
      set((state) => ({
        areas: state.areas.map((area) => (area.id === id ? { ...area, labelOffset: offset } : area))
      }))
    },

    setStoreLabelMode(mode) {
      set({ storeLabelMode: mode })
    },
```

- [ ] **Step 5: Persist in `App.tsx` `saveProject`**

In the `ProjectFile` literal, add after `legendOrientation: state.legendOrientation`:

```ts
storeLabelMode: state.storeLabelMode
```

(add a trailing comma to the preceding line as needed).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: PASS (all store tests + the three new ones).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/types.ts src/renderer/src/state/store.ts src/renderer/src/App.tsx src/renderer/src/state/store.spec.ts
git commit -m "feat: labelOffset + storeLabelMode state and persistence"
```

---

## Task 2: `storeTagLabel` pure helper

**Files:**

- Create: `src/renderer/src/state/storeLabel.ts`
- Test: `src/renderer/src/state/storeLabel.spec.ts`

**Interfaces:**

- Consumes: `StoreLabelMode` (Task 1).
- Produces: `export function storeTagLabel(code: string | undefined, prefix: string | undefined, mode: StoreLabelMode): string | null`. Used by Task 3 (canvas) and Task 5 (export).

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/state/storeLabel.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { storeTagLabel } from './storeLabel'

describe('storeTagLabel', () => {
  it('returns the full code in code mode', () => {
    expect(storeTagLabel('S本館007', 'S本館', 'code')).toBe('S本館007')
  })

  it('returns the integer part in number mode, stripping the prefix and leading zeros', () => {
    expect(storeTagLabel('S本館007', 'S本館', 'number')).toBe('7')
  })

  it('finds the first digit run in number mode even without a prefix', () => {
    expect(storeTagLabel('S本館007', undefined, 'number')).toBe('7')
  })

  it('ignores a non-numeric suffix in number mode', () => {
    expect(storeTagLabel('ts002A', 'ts', 'number')).toBe('2')
  })

  it('falls back to the raw value when there are no digits', () => {
    expect(storeTagLabel('abc', undefined, 'number')).toBe('abc')
  })

  it('shows an em dash for a missing code in code and number modes', () => {
    expect(storeTagLabel(undefined, 'x', 'code')).toBe('—')
    expect(storeTagLabel(undefined, 'x', 'number')).toBe('—')
  })

  it('returns null in off mode', () => {
    expect(storeTagLabel('S本館007', 'S本館', 'off')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/storeLabel.spec.ts`
Expected: FAIL — cannot find module `./storeLabel`.

- [ ] **Step 3: Implement `storeTagLabel`**

Create `src/renderer/src/state/storeLabel.ts`:

```ts
import type { StoreLabelMode } from './types'

// The label shown for a store given the display mode and the facility's code
// prefix. Returns null when the store should have no tag (mode 'off').
export function storeTagLabel(
  code: string | undefined,
  prefix: string | undefined,
  mode: StoreLabelMode
): string | null {
  if (mode === 'off') return null
  const value = (code ?? '').trim() || '—'
  if (mode === 'code') return value
  // mode 'number': strip a matching prefix, take the first digit run as an
  // integer (drops leading zeros); fall back to the raw value if it has no digits.
  const body = prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value
  const match = body.match(/\d+/)
  return match ? String(Number.parseInt(match[0], 10)) : value
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/state/storeLabel.spec.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/storeLabel.ts src/renderer/src/state/storeLabel.spec.ts
git commit -m "feat: storeTagLabel helper (code/number/off)"
```

---

## Task 3: Auto-sized tag box + store label on canvas

**Files:**

- Modify: `src/renderer/src/components/PdfStage.tsx` (types import ~line 14; `TAG`/helpers near `const LEGEND = LEGEND_LAYOUT` ~line 81; tag draw block in `drawPolygon` ~lines 263-277)
- Test: `src/renderer/src/components/PdfStage.spec.ts`

**Interfaces:**

- Consumes: `Area.labelOffset`, `AppState.storeLabelMode` (Task 1); `storeTagLabel` (Task 2).
- Produces (module-level in `PdfStage.tsx`):
  - `export function tagBoxSize(lineWidths: number[]): { width: number; height: number }`
  - `function tagLines(area: Area, state: Pick<AppState, 'pages' | 'prefixes' | 'storeLabelMode'>): string[]`
  - `function tagRect(area, ctx, viewport, state): { x: number; y: number; w: number; h: number; lines: string[] } | null`
  - `const TAG = { font: 13, weight: 600, lineH: 15, padX: 10, padY: 8 }`

- [ ] **Step 1: Write the failing test**

In `src/renderer/src/components/PdfStage.spec.ts`, update the import on line 3:

```ts
import {
  anchoredZoomScroll,
  constrainDelta,
  doubleClickAction,
  shouldPanPointer,
  tagBoxSize
} from './PdfStage'
```

Add at the end of the file:

```ts
describe('tagBoxSize', () => {
  it('sizes a one-line tag: widest line + padding, one line-height + padding', () => {
    expect(tagBoxSize([40])).toEqual({ width: 60, height: 31 })
  })

  it('sizes a two-line tag to the widest line and grows taller per line', () => {
    expect(tagBoxSize([120, 30])).toEqual({ width: 140, height: 46 })
  })

  it('falls back to padding-only when there are no lines', () => {
    expect(tagBoxSize([])).toEqual({ width: 20, height: 16 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts`
Expected: FAIL — `tagBoxSize` not exported.

- [ ] **Step 3: Add imports**

Change the types import line to add `AppState`:

```ts
import type { AppState, Area, LegendOrientation, Pt, Tool } from '../state/types'
```

Add near the other `../state/store` / report imports at the top of the file:

```ts
import { storeTagLabel } from '../state/storeLabel'
```

- [ ] **Step 4: Add the `TAG` constant and helpers**

Immediately after `const LEGEND = LEGEND_LAYOUT`:

```ts
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
```

(`centroid`, `viewportPt`, `areaM2`, `REPORT_FONT_FAMILY`, and `PageViewport` are already in scope.)

- [ ] **Step 5: Rewrite the tag draw block in `drawPolygon`**

Replace the tag block (from `const labelPt = viewportPt(viewport, centroid(area.polygon))` through the final `lines.forEach(... labelPt.y - 7 + index * 15)`) with:

```ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. (The component's `state` is the full store, which structurally satisfies `Pick<AppState, 'pages' | 'prefixes' | 'storeLabelMode'>`.)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/PdfStage.tsx src/renderer/src/components/PdfStage.spec.ts
git commit -m "feat: auto-size tag box and apply store label mode on canvas"
```

---

## Task 4: Draggable tags in Edit tool + double-click reset

**Files:**

- Modify: `src/renderer/src/components/PdfStage.tsx` (`DragState` ~lines 30-40; `setAreaLabelOffset` selector ~line 161; `findTagAt` after `findAreaAt` ~line 419; edit branch of `onPointerDown` ~line 500; `onPointerMove` after the legend branch ~line 614; `onDoubleClick` ~line 622)

**Interfaces:**

- Consumes: `tagRect` (Task 3), `setAreaLabelOffset` + `Area.labelOffset` (Task 1), existing `eventToViewportPt`, `findAreaAt`, `doubleClickAction`.
- Produces: internal `findTagAt(viewportPoint: Pt): Area | null`; `DragState` `'label'` kind.

- [ ] **Step 1: Extend `DragState`**

```ts
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
```

- [ ] **Step 2: Subscribe to the action**

Next to `const setAreaPolygon = useAreaStore((s) => s.setAreaPolygon)`:

```ts
const setAreaLabelOffset = useAreaStore((s) => s.setAreaLabelOffset)
```

- [ ] **Step 3: Add `findTagAt`**

Immediately after the `findAreaAt` function:

```ts
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
```

- [ ] **Step 4: Start a label drag in the Edit branch of `onPointerDown`**

At the very top of the `if (tool === 'edit') {` block (before `const vertex = findVertexHit(viewportPoint)`):

```ts
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
```

- [ ] **Step 5: Handle the label drag in `onPointerMove`**

Immediately after the existing `if (drag.kind === 'legend' && ...) { ... }` block:

```ts
if (drag.kind === 'label' && drag.areaId && drag.startPt && drag.startLabelOffset) {
  if (moved) {
    setAreaLabelOffset(drag.areaId, {
      x: drag.startLabelOffset.x + (pdfPt.x - drag.startPt.x),
      y: drag.startLabelOffset.y + (pdfPt.y - drag.startPt.y)
    })
  }
  setDrag({ ...drag, moved })
}
```

- [ ] **Step 6: Double-click a tag in Edit to reset its offset**

In `onDoubleClick`, immediately after the `const pdfPt = eventToPdfPt(...)` line and before the `doubleClickAction(...)` check:

```ts
if (tool === 'edit') {
  const viewportPoint = eventToViewportPt(event.nativeEvent as PointerEvent, overlayRef.current)
  const tagArea = findTagAt(viewportPoint)
  if (tagArea) {
    setAreaLabelOffset(tagArea.id, { x: 0, y: 0 })
    return
  }
}
```

- [ ] **Step 7: Typecheck + full suite (no regressions)**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run`
Expected: all pass (drag/reset wiring adds no unit tests, consistent with existing drag code).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/PdfStage.tsx
git commit -m "feat: drag area tags in edit tool, double-click to reset"
```

---

## Task 5: Toolbar Store-tags control + export follows mode

**Files:**

- Modify: `src/renderer/src/components/Toolbar.tsx` (selectors ~lines 39-44; new group after the Legend group ~line 140)
- Modify: `src/renderer/src/report/buildReport.ts` (type import ~line 3; new import; `drawAreaOverlays` ~lines 29-56; `buildReportPdf` ~lines 80-90)
- Modify: `src/renderer/src/App.tsx` (`generateReport` `buildReportPdf` call)

**Interfaces:**

- Consumes: `storeLabelMode` + `setStoreLabelMode` (Task 1); `storeTagLabel` (Task 2).
- Produces: `buildReportPdf(..., storeLabels?: { mode: StoreLabelMode; prefixes: Record<string, string> })`.

- [ ] **Step 1: Toolbar selectors**

In `Toolbar.tsx`, next to the existing legend selectors:

```ts
const storeLabelMode = useAreaStore((s) => s.storeLabelMode)
const setStoreLabelMode = useAreaStore((s) => s.setStoreLabelMode)
```

- [ ] **Step 2: Toolbar "Store tags" group**

Insert immediately after the closing `</div>` of the Legend group (before the `toolbar__group--end` group):

```tsx
<div className="toolbar__group" aria-label="Store tags">
  <button
    type="button"
    className={storeLabelMode === 'code' ? 'is-active' : ''}
    onClick={() => setStoreLabelMode('code')}
  >
    Code
  </button>
  <button
    type="button"
    className={storeLabelMode === 'number' ? 'is-active' : ''}
    onClick={() => setStoreLabelMode('number')}
  >
    Number
  </button>
  <button
    type="button"
    className={storeLabelMode === 'off' ? 'is-active' : ''}
    onClick={() => setStoreLabelMode('off')}
  >
    Off
  </button>
</div>
```

- [ ] **Step 3: Thread the mode through the export**

In `src/renderer/src/report/buildReport.ts`:

(a) Add `StoreLabelMode` to the `import type { … } from '../state/types'` line, and add:

```ts
import { storeTagLabel } from '../state/storeLabel'
```

(b) Change `drawAreaOverlays`'s signature to accept the options:

```ts
function drawAreaOverlays(
  doc: PDFDocument,
  areas: Area[],
  colors: Record<string, string>,
  codeFont: PDFFont,
  storeLabels: { mode: StoreLabelMode; prefixes: Record<string, string> }
): void {
```

(c) Replace the `if (area.kind === 'store' && area.code) { ... }` block with:

```ts
if (area.kind === 'store') {
  const label = storeTagLabel(area.code, storeLabels.prefixes[area.name], storeLabels.mode)
  if (label) {
    const c = centroid(area.polygon)
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
```

(d) Change `buildReportPdf` to accept and forward the options. Update its signature to add a trailing parameter:

```ts
export async function buildReportPdf(
  originalBytes: Uint8Array,
  png: Uint8Array,
  areas: Area[] = [],
  colors: Record<string, string> = {},
  legend?: LegendOptions,
  storeLabels: { mode: StoreLabelMode; prefixes: Record<string, string> } = { mode: 'code', prefixes: {} }
): Promise<Uint8Array> {
```

and change the `drawAreaOverlays(doc, areas, colors, codeFont)` call to:

```ts
drawAreaOverlays(doc, areas, colors, codeFont, storeLabels)
```

- [ ] **Step 4: Pass the options from `App.tsx` `generateReport`**

In the `buildReportPdf(...)` call, add a 6th argument after the legend options object:

```ts
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
  { mode: state.storeLabelMode, prefixes: state.prefixes }
)
```

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run`
Expected: all pass — including `buildReport.spec.ts`, which calls `buildReportPdf` without the new argument and relies on the `code` default (draws `ts001` as before).

- [ ] **Step 6: Manual verification (`npm run dev`, any vector PDF)**

- Long facility name → tag box grows to contain the whole name (no overflow).
- Edit tool: drag a tag off a room → moves and stays; polygon does not move. Double-click the moved tag → snaps back to centroid.
- Draw tool: click where a tag sits → a draft vertex is placed (no tag drag).
- Toolbar Store tags: **Number** → store tags show `1, 2, 3…`; **Off** → store tags disappear; **Code** → full codes return. Facility tags unaffected in every mode.
- Generate Report in each mode → the exported PDF's in-place store labels match (numbers / hidden / full codes).
- Save Project → JSON has `storeLabelMode` and `labelOffset` for moved tags; Open Project restores both (toolbar mode highlight + tag positions).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/Toolbar.tsx src/renderer/src/report/buildReport.ts src/renderer/src/App.tsx
git commit -m "feat: store-tag mode toolbar control + export follows mode"
```

---

## Self-Review

**1. Spec coverage:**

- Auto-size box → Task 3 (`tagBoxSize`, `tagRect`, draw rewrite). ✓
- `Area.labelOffset` delta + `setAreaLabelOffset` + persistence → Task 1; applied in Task 3 (`tagRect`) + Task 4 (drag/reset). ✓
- `storeTagLabel` (code/number/off, prefix strip, integer, fallback) → Task 2. ✓
- `storeLabelMode` state + persistence → Task 1; toolbar → Task 5; canvas use → Task 3 (`tagLines`); export use → Task 5 (`drawAreaOverlays`). ✓
- Edit-only drag before vertex, no selection change → Task 4. ✓ Double-click reset → Task 4. ✓
- Export follows mode; default `code` keeps `buildReport.spec` green → Task 5. ✓
- Facility tags unchanged; summary page + legendImage untouched; no version bump → Global Constraints (no task edits `reportImage.ts`/`legendImage.ts`/`ProjectFile.version`; `tagLines` facility branch unchanged). ✓
- Tests: `storeTagLabel`, `tagBoxSize`, `setAreaLabelOffset`/`setStoreLabelMode`/import → Tasks 2/3/1. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**3. Type consistency:**

- `storeTagLabel(code?: string, prefix?: string, mode: StoreLabelMode) → string | null` identical in Task 2 def, Task 3 (`tagLines`), Task 5 (`drawAreaOverlays`). ✓
- `setAreaLabelOffset(id: string, offset: Pt)` and `setStoreLabelMode(mode: StoreLabelMode)` identical across Task 1 interface/impl and Task 4/Task 5 callers. ✓
- `tagRect(...) → { x, y, w, h, lines } | null` consistent where defined (Task 3) and consumed (`findTagAt`, draw — Tasks 3/4). ✓
- `buildReportPdf` store-label param `{ mode: StoreLabelMode; prefixes: Record<string, string> }` matches the `App.tsx` caller and `drawAreaOverlays` parameter. ✓
- `DragState.kind` union includes `'label'` before any `drag.kind === 'label'` use. ✓

No gaps found.
