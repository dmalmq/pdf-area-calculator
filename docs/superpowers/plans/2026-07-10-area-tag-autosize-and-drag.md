# Auto-sized, Draggable Area Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each area's on-canvas tag auto-size to its text (so long facility names stop overflowing) and let the user drag a tag off underlying content, with the moved position persisted per area.

**Architecture:** A per-area `labelOffset` (delta from centroid, in PDF points) lives on the `Area` model and is persisted through the existing project save/load. On the canvas, one shared `tagRect` helper (built on a pure `tagBoxSize`) drives both drawing and hit-testing, so the box that is drawn is exactly the box you can grab. Dragging is wired into the Edit tool only, mirroring the existing legend-drag `DragState` pattern; double-clicking a tag in Edit resets its offset.

**Tech Stack:** TypeScript, React 19, Zustand, pdf.js (`PageViewport`), canvas 2D, Vitest. Electron app; renderer code under `src/renderer/src`.

## Global Constraints

- The **exported PDF pipeline is untouched**: `src/renderer/src/report/buildReport.ts` and `report/legendImage.ts` are NOT modified. Store codes stay centered at the polygon centroid; facilities remain unlabeled in place (named via the legend).
- **No project-file format-version bump.** `labelOffset` is an additive optional field; `ProjectFile.version` stays `1 | 2`.
- **Tag drag is Edit-tool-only.** Draw-tool clicks must keep placing vertices (including inside an existing polygon); Pan pans. Legend drag keeps its existing priority ahead of all tool logic.
- **Tags stay a fixed screen size** (font `600 13px`, as today). Only the box width/height change from hard-coded to measured. The offset is stored in PDF points so it tracks the page under zoom/pan.
- `labelOffset` is a **delta from the centroid** (not an absolute position), so a tag follows its polygon when the polygon is moved or reshaped.
- Match existing conventions: immutable Zustand updates via `set((state) => ...)`; module-level pure helpers exported for unit testing (as `shouldPanPointer`, `tagBoxSize`); keep tests deterministic.

---

## File Structure

- `src/renderer/src/state/types.ts` — add optional `labelOffset?: Pt` to `Area`. (Automatically flows into `ProjectFile.areas`, which is typed `Array<Omit<Area, 'kind'> & { kind?: AreaKind }>`.)
- `src/renderer/src/state/store.ts` — add `setAreaLabelOffset(id, offset)` action + interface entry; map `labelOffset` in `importProject`. `saveProject` already serializes `state.areas` whole — no change there.
- `src/renderer/src/components/PdfStage.tsx` — add `TAG` constants, `tagBoxSize` (exported, pure), `tagLines`, `tagRect` (module-level); rewrite the tag draw block in `drawPolygon`; add `'label'` to `DragState` + `startLabelOffset`; add `findTagAt`, a `setAreaLabelOffset` selector, the pointer-down/move label branches, and the double-click reset.
- `src/renderer/src/state/store.spec.ts` — tests for `setAreaLabelOffset` and `importProject` round-trip.
- `src/renderer/src/components/PdfStage.spec.ts` — tests for `tagBoxSize`.

---

## Task 1: Per-area label offset — state, action, persistence

**Files:**
- Modify: `src/renderer/src/state/types.ts` (add `Area.labelOffset?`)
- Modify: `src/renderer/src/state/store.ts` (`AreaStore` interface ~line 61; `importProject` mapped area ~line 469-476; new action after `setAreaPolygon` ~line 556)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Produces: `Area.labelOffset?: Pt`; `AreaStore.setAreaLabelOffset(id: string, offset: Pt): void`. Later tasks (PdfStage drag/reset) call `setAreaLabelOffset` and read `area.labelOffset`.

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/src/state/store.spec.ts` (uses the existing `pages` and `square` helpers at the top of the file; `createAreaStore` is already imported):

```ts
  it('sets a per-area label offset without touching other areas', () => {
    const a = square(0, 'A')
    const b = square(0, 'B')
    const store = createAreaStore({ areas: [a, b] })

    store.getState().setAreaLabelOffset(a.id, { x: 5, y: -3 })

    expect(store.getState().areas.find((area) => area.id === a.id)?.labelOffset).toEqual({ x: 5, y: -3 })
    expect(store.getState().areas.find((area) => area.id === b.id)?.labelOffset).toBeUndefined()
  })

  it('preserves labelOffset through importProject and leaves it undefined when omitted', () => {
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
      ]
    })

    expect(store.getState().areas[0].labelOffset).toEqual({ x: 7, y: 8 })
    expect(store.getState().areas[1].labelOffset).toBeUndefined()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: FAIL — `setAreaLabelOffset` is not a function / `labelOffset` type error (the second test may fail to compile until `Area.labelOffset` exists, which is fine — that is the red state).

- [ ] **Step 3: Add the `Area.labelOffset` field**

In `src/renderer/src/state/types.ts`, in `interface Area`, change the `polygon` line to add the new field right after it:

```ts
  polygon: Pt[] // vertices in PDF pt space
  labelOffset?: Pt // tag position as a delta from the centroid, in PDF points; absent = centroid
```

- [ ] **Step 4: Add the store action + interface entry + import mapping**

In `src/renderer/src/state/store.ts`:

(a) In the `AreaStore` interface, right after `setAreaPolygon(id: string, polygon: Pt[]): void`:

```ts
  setAreaLabelOffset(id: string, offset: Pt): void
```

(b) In `importProject`, in the `project.areas.map((area) => ({ ... }))` object, change the `polygon` line to add `labelOffset`:

```ts
          polygon: area.polygon,
          labelOffset: area.labelOffset
```

(c) Implement the action immediately after the `setAreaPolygon(id, polygon) { ... },` implementation:

```ts
    setAreaLabelOffset(id, offset) {
      set((state) => ({
        areas: state.areas.map((area) => (area.id === id ? { ...area, labelOffset: offset } : area))
      }))
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: PASS (all store tests, including the two new ones).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean (no output, exit 0).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/types.ts src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: per-area tag label offset state + persistence"
```

---

## Task 2: Auto-sized tag box

**Files:**
- Modify: `src/renderer/src/components/PdfStage.tsx` (add `AppState` to the types import ~line 14; add `TAG` const near `const LEGEND = LEGEND_LAYOUT` ~line 81; add `tagBoxSize`/`tagLines`/`tagRect` module-level helpers; rewrite the tag draw block in `drawPolygon` ~lines 263-277)
- Test: `src/renderer/src/components/PdfStage.spec.ts`

**Interfaces:**
- Consumes: `Area.labelOffset` (Task 1).
- Produces (all module-level in `PdfStage.tsx`):
  - `export function tagBoxSize(lineWidths: number[]): { width: number; height: number }`
  - `function tagLines(area: Area, state: Pick<AppState, 'pages'>): string[]`
  - `function tagRect(area: Area, ctx: CanvasRenderingContext2D, viewport: PageViewport, state: Pick<AppState, 'pages'>): { x: number; y: number; w: number; h: number }`
  - `const TAG = { font: 13, weight: 600, lineH: 15, padX: 10, padY: 8 }`

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/components/PdfStage.spec.ts`. Update the import on line 3 to include `tagBoxSize`:

```ts
import { anchoredZoomScroll, constrainDelta, doubleClickAction, shouldPanPointer, tagBoxSize } from './PdfStage'
```

Add this `describe` block at the end of the file (after the existing `describe(...)` closes):

```ts
describe('tagBoxSize', () => {
  it('sizes a one-line store tag: widest line + padding, one line-height + padding', () => {
    expect(tagBoxSize([40])).toEqual({ width: 60, height: 31 })
  })

  it('sizes a two-line facility tag to the widest line and grows taller per line', () => {
    expect(tagBoxSize([120, 30])).toEqual({ width: 140, height: 46 })
  })

  it('falls back to padding-only when there are no lines (Math.max(0) guard)', () => {
    expect(tagBoxSize([])).toEqual({ width: 20, height: 16 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts`
Expected: FAIL — `tagBoxSize` is not exported / not a function.

- [ ] **Step 3: Add the `AppState` import**

In `src/renderer/src/components/PdfStage.tsx`, change the types import line:

```ts
import type { AppState, Area, LegendOrientation, Pt, Tool } from '../state/types'
```

- [ ] **Step 4: Add the `TAG` constant and pure helpers**

In `src/renderer/src/components/PdfStage.tsx`, immediately after `const LEGEND = LEGEND_LAYOUT` add:

```ts
const TAG = { font: 13, weight: 600, lineH: 15, padX: 10, padY: 8 }

// Tag box (screen px) sized to its text: widest line plus horizontal padding on
// both sides, and one line-height per line plus vertical padding. Auto-grows so
// long facility names always fit.
export function tagBoxSize(lineWidths: number[]): { width: number; height: number } {
  return {
    width: Math.max(0, ...lineWidths) + TAG.padX * 2,
    height: lineWidths.length * TAG.lineH + TAG.padY * 2
  }
}

// The lines shown in an area's tag: store → its code; facility → name + area.
function tagLines(area: Area, state: Pick<AppState, 'pages'>): string[] {
  if (area.kind === 'store') return [area.code || '—']
  const scaled = areaM2(state, area)
  return [area.name, scaled == null ? 'unscaled' : `${scaled.toFixed(2)} m²`]
}

// The tag's screen-px rectangle: centroid + labelOffset (PDF pt) → viewport px,
// auto-sized to its measured text and centered on that point. Shared by the draw
// path and hit-testing so the drawn box and the grabbable box are identical.
function tagRect(
  area: Area,
  ctx: CanvasRenderingContext2D,
  viewport: PageViewport,
  state: Pick<AppState, 'pages'>
): { x: number; y: number; w: number; h: number } {
  const anchor = centroid(area.polygon)
  const offset = area.labelOffset ?? { x: 0, y: 0 }
  const center = viewportPt(viewport, { x: anchor.x + offset.x, y: anchor.y + offset.y })
  const lines = tagLines(area, state)
  ctx.font = `${TAG.weight} ${TAG.font}px ${REPORT_FONT_FAMILY}`
  const widths = lines.map((line) => ctx.measureText(line).width)
  const { width, height } = tagBoxSize(widths)
  return { x: center.x - width / 2, y: center.y - height / 2, w: width, h: height }
}
```

(`centroid`, `viewportPt`, `areaM2`, and `REPORT_FONT_FAMILY` are already in scope in this file.)

- [ ] **Step 5: Rewrite the tag draw block in `drawPolygon`**

In `src/renderer/src/components/PdfStage.tsx`, replace the tag block inside `drawPolygon` (the lines from `const labelPt = viewportPt(viewport, centroid(area.polygon))` through the final `lines.forEach(... labelPt.y - 7 + index * 15)` — the hard-coded `- 58 / - 20 / 116 / 40` box) with:

```ts
      const rect = tagRect(area, ctx, viewport, state)
      const lines = tagLines(area, state)
      ctx.font = `${TAG.weight} ${TAG.font}px ${REPORT_FONT_FAMILY}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#111827'
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
      ctx.strokeStyle = '#ffffff'
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
      ctx.fillStyle = '#ffffff'
      lines.forEach((line, index) =>
        ctx.fillText(line, rect.x + rect.w / 2, rect.y + TAG.padY + TAG.lineH / 2 + index * TAG.lineH)
      )
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/components/PdfStage.spec.ts`
Expected: PASS (existing helpers + the three `tagBoxSize` cases).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. (If `state` is flagged as not matching `Pick<AppState, 'pages'>`, note the component's `state` is the full store which structurally satisfies `Pick<AppState, 'pages'>` — no cast needed.)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/PdfStage.tsx src/renderer/src/components/PdfStage.spec.ts
git commit -m "feat: auto-size area tag box to its text"
```

---

## Task 3: Draggable tags in Edit tool + double-click reset

**Files:**
- Modify: `src/renderer/src/components/PdfStage.tsx` (`DragState` ~lines 30-40; `setAreaLabelOffset` selector ~line 161; `findTagAt` near `findAreaAt` ~line 414; edit branch of `onPointerDown` ~line 500; `onPointerMove` label branch ~after line 614; `onDoubleClick` ~line 622)

**Interfaces:**
- Consumes: `tagRect` (Task 2), `setAreaLabelOffset` + `Area.labelOffset` (Task 1), existing `eventToViewportPt`, `findAreaAt`, `doubleClickAction`.
- Produces: no new exports; internal `findTagAt(viewportPoint: Pt): Area | null` and the `'label'` `DragState` kind.

- [ ] **Step 1: Extend `DragState`**

In `src/renderer/src/components/PdfStage.tsx`, update `interface DragState`:

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

- [ ] **Step 2: Subscribe to the `setAreaLabelOffset` action**

Add next to the other action selectors (near `const setAreaPolygon = useAreaStore((s) => s.setAreaPolygon)`):

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

Inside `onPointerDown`, at the very top of the `if (tool === 'edit') {` block (before `const vertex = findVertexHit(viewportPoint)`):

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

In `onPointerMove`, immediately after the existing `if (drag.kind === 'legend' && ...) { ... }` block:

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

In `onDoubleClick`, immediately after `const pdfPt = eventToPdfPt(event.nativeEvent as PointerEvent, overlayRef.current, viewport)` and before the `doubleClickAction(...)` check:

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

- [ ] **Step 7: Typecheck + full test suite (no regressions)**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run`
Expected: all pass (the Task 1 + Task 2 tests plus the pre-existing suite; drag wiring adds no new unit tests, consistent with the existing legend/vertex/area drag code which is covered by its pure helpers).

- [ ] **Step 8: Manual verification (`npm run dev`, any vector PDF)**

- Draw a facility with a long name → the tag box grows to contain the full name (no overflow).
- Edit tool: press-drag a tag off a room → the tag moves, the polygon does NOT; release and it stays.
- Edit tool: double-click the moved tag → it snaps back to the centroid.
- Draw tool: click where a tag sits → a draft vertex is placed (no tag drag) — the draw-inside-polygon behavior is intact.
- Save Project → the JSON `areas` contain `labelOffset` for moved tags; Open Project → moved positions are restored.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/PdfStage.tsx
git commit -m "feat: drag area tags in edit tool, double-click to reset"
```

---

## Self-Review

**1. Spec coverage:**
- Auto-size box → Task 2 (`tagBoxSize` + `tagRect` + rewritten draw). ✓
- `Area.labelOffset?` delta from centroid → Task 1 (types) + Task 3 (applied via `tagRect` anchor). ✓
- `setAreaLabelOffset` action → Task 1. ✓
- Persistence (importProject map; saveProject unchanged) → Task 1. ✓
- Shared `tagRect` for draw + hit-test → Task 2 (defines) + Task 3 (`findTagAt` reuses). ✓
- Edit-tool-only drag, before vertex hit; no selection change → Task 3 Step 4. ✓
- `onPointerMove` label branch mirroring legend → Task 3 Step 5. ✓
- Double-click reset in Edit → Task 3 Step 6. ✓
- Export untouched, no version bump, fixed screen size → Global Constraints (no task modifies `buildReport`/`legendImage`/`ProjectFile.version`; `TAG.font` fixed). ✓
- Tests for `tagBoxSize` and `setAreaLabelOffset`/import → Task 2 / Task 1. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**3. Type consistency:** `setAreaLabelOffset(id: string, offset: Pt)` identical in Task 1 interface, impl, and Task 3 callers. `tagRect(area, ctx, viewport, state)` signature identical where defined (Task 2) and called (`findTagAt`, draw). `tagBoxSize(number[]) → {width, height}` consistent in helper, tests, and `tagRect`. `DragState.kind` union includes `'label'` before any `drag.kind === 'label'` use. ✓

No gaps found.
