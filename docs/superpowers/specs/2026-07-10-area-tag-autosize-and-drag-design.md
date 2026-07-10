# Auto-sized, draggable area tags

## Problem

Each area on the canvas draws a "tag" at its polygon centroid:
- **Facility** tags show two lines: the facility name and its area (`<n> m²`, or `unscaled`).
- **Store** tags show one line: the store code (e.g. `ts001`).

Two problems, both on the on-canvas editing view only:

1. **Overflow** — the tag box is a fixed `116×40` px rectangle. Long facility
   names render wider than the box, so the text spills outside the tag.
2. **No repositioning** — a tag sits at the centroid and can cover an
   underlying room or label the user needs to see. There is no way to move it.

## Scope (decided)

- **Overflow fix**: auto-size the tag box to its text (grow the box; no
  wrapping, no font shrinking).
- **Move**: tags are draggable in the **Edit tool**, and the moved position
  **persists** in the project file. It affects **the on-canvas view only** —
  the exported PDF is unchanged.

### Out of scope

- Export-side label movement. The exported PDF keeps store codes centered at
  the polygon centroid, and facilities remain unlabeled in place (named via the
  legend). `buildReport.ts` is not touched.
- Line wrapping and font auto-shrinking for long names.
- Scaling the tag with zoom. Tags stay a fixed screen size (as today); only the
  box dimensions change from fixed to measured.

## Design

All changes are in `src/renderer/src/components/PdfStage.tsx`, plus a per-area
state field (`types.ts`), one store action (`store.ts`), and its persistence
mapping (`store.ts` `importProject`). The exported PDF pipeline is untouched.

### 1. Auto-sized tag box

Introduce tag layout constants and a pure sizing helper, both module-level in
`PdfStage.tsx`:

```ts
const TAG = { font: 13, weight: 600, lineH: 15, padX: 10, padY: 8 }

// Box dimensions (screen px) for a tag whose lines have the given measured
// widths. width = widest line + horizontal padding on both sides;
// height = one lineH per line + vertical padding on both sides.
export function tagBoxSize(lineWidths: number[]): { width: number; height: number } {
  return {
    width: Math.max(0, ...lineWidths) + TAG.padX * 2,
    height: lineWidths.length * TAG.lineH + TAG.padY * 2
  }
}
```

Two shared helpers remove duplication between drawing and hit-testing:

- `tagLines(area, state): string[]` — the lines for an area (store → `[code || '—']`;
  facility → `[name, areaM2 == null ? 'unscaled' : '<n> m²']`). Reused by draw and `tagRect`.
- `tagRect(area, ctx): { x, y, w, h }` — the tag's screen-px rectangle:
  1. `anchorPdf = centroid(area.polygon) + (area.labelOffset ?? { x: 0, y: 0 })`
  2. `center = viewportPt(viewport, anchorPdf)`
  3. measure each `tagLines(area, state)` line at `${TAG.weight} ${TAG.font}px REPORT_FONT_FAMILY`
  4. `size = tagBoxSize(widths)`
  5. rect centered on `center`: `{ x: center.x - size.width/2, y: center.y - size.height/2, w: size.width, h: size.height }`

The draw path (`drawPolygon`) uses `tagRect` for the box and draws each line
centered (`textAlign 'center'`, `textBaseline 'middle'`) at
`rect.x + rect.w/2`, `rect.y + TAG.padY + TAG.lineH/2 + i*TAG.lineH`. Colors are
unchanged (dark `#111827` fill, white stroke, white text). This replaces the
hard-coded `labelPt.x - 58`, `± 20`, `116`, `40`, and `labelPt.y - 7 + index*15`
math.

### 2. Per-area label offset (state + persistence)

`types.ts` — add to `Area`:

```ts
labelOffset?: Pt // tag position as a delta from the centroid, in PDF points; absent = centroid
```

It is a **delta from the centroid**, so the tag follows the polygon when the
area is moved or reshaped. Absent or `{ x: 0, y: 0 }` reproduces today's
centered behavior. Because `ProjectFile.areas` is typed `Array<Omit<Area, 'kind'> & …>`,
this optional field flows into the project type automatically.

`store.ts`:
- `AreaStore` gains `setAreaLabelOffset(id: string, offset: Pt): void`, implemented
  as an immutable map update (mirrors `setAreaPolygon`):
  ```ts
  setAreaLabelOffset(id, offset) {
    set((state) => ({
      areas: state.areas.map((area) => (area.id === id ? { ...area, labelOffset: offset } : area))
    }))
  }
  ```
- `importProject` maps `labelOffset: area.labelOffset` onto each imported area
  (alongside the existing `id`/`pageIndex`/`kind`/`name`/`code`/`polygon`).
- `saveProject` (`App.tsx`) already serializes `state.areas` whole, so
  `labelOffset` is persisted with no change there.
- **Copy/paste**: `CopiedArea` is not extended; pasted areas start at the
  centroid (offset absent). Intentional — a paste is a fresh area.

### 3. Drag interaction (Edit tool only)

`DragState` gains `kind: '… | 'label'` and a `startLabelOffset?: Pt` field.

A `findTagAt(viewportPoint): Area | null` helper iterates `pageAreas` top-most
first and returns the first area whose `tagRect` contains the point (skipping
areas with fewer than 2 vertices, matching the draw guard). It reads the overlay
2D context for measurement.

- **onPointerDown**, inside the `tool === 'edit'` branch, **before** the vertex
  hit test: if `findTagAt(viewportPoint)` returns an area, start a label drag —
  `setDrag({ kind: 'label', areaId, startClient, startPan: pan, startPt: pdfPt, startLabelOffset: area.labelOffset ?? { x: 0, y: 0 }, moved: false })` — and return.
  Label drag does not change the current selection.
- **onPointerMove**, new branch for `drag.kind === 'label'` (mirrors the legend
  branch): once past the existing `moved` threshold, compute
  `offset = { x: startLabelOffset.x + (pdfPt.x - startPt.x), y: startLabelOffset.y + (pdfPt.y - startPt.y) }`
  and call `setAreaLabelOffset(drag.areaId, offset)`.
- **onPointerUp** is unchanged (`setDrag(null)`).

Why Edit-tool-only: in the Draw tool a click must place a vertex — including
inside an existing polygon (the recently shipped draw-inside-polygon fix).
Hit-testing tags there would steal those clicks and reintroduce that bug. The
Pan tool pans. Edit is where areas are already being adjusted, so tag dragging
belongs there. Legend dragging keeps its existing priority ahead of all tool
logic.

### 4. Reset (double-click a tag in Edit)

`onDoubleClick`: when `tool === 'edit'`, first `findTagAt` at the event point;
if it hits, call `setAreaLabelOffset(id, { x: 0, y: 0 })` and return (snap back to
centroid). Otherwise fall through to the existing double-click behavior
(select area + switch to Edit / close draft). The two single pointerdowns that
precede a double-click each start a label drag with `moved: false`, which writes
nothing, so the reset is clean.

## Testing

- `PdfStage.spec.ts` — `tagBoxSize`:
  - `tagBoxSize([40])` → `{ width: 40 + 20, height: 15 + 16 }` = `{ 60, 31 }` (store, 1 line).
  - `tagBoxSize([120, 30])` → `{ width: 120 + 20, height: 30 + 16 }` = `{ 140, 46 }` (facility, wide name).
  - `tagBoxSize([])` → `{ width: 20, height: 16 }` (padding only; `Math.max(0)` guard).
- `store.spec.ts`:
  - `setAreaLabelOffset(id, { x: 5, y: -3 })` sets that area's `labelOffset` and
    leaves other areas untouched.
  - `importProject` preserves a supplied `labelOffset`, and yields `undefined`
    when omitted.
- Drag/reset wiring reuses the existing, already-tested `DragState` pattern
  (legend/vertex/area drags); the pure pieces above carry the unit coverage.

## Files touched

- `src/renderer/src/state/types.ts` — `Area.labelOffset?`.
- `src/renderer/src/state/store.ts` — `setAreaLabelOffset`, `importProject` mapping.
- `src/renderer/src/components/PdfStage.tsx` — `TAG`, `tagBoxSize`, `tagLines`,
  `tagRect`, `findTagAt`; rewritten label draw; `DragState` `'label'` kind;
  pointer-down/move label branches; double-click reset.
- `src/renderer/src/components/PdfStage.spec.ts`, `store.spec.ts` — tests.
- Not touched: `report/buildReport.ts`, `report/legendImage.ts`, `App.tsx`
  (`saveProject` already serializes areas whole).

## Verification

- `npx vitest run` — all pass, including new `tagBoxSize` / `setAreaLabelOffset`
  / import tests.
- `npm run typecheck` — clean.
- Manual (`npm run dev`, any vector PDF):
  - Draw a facility with a long name → the tag box grows to contain the whole
    name (no overflow).
  - Edit tool: drag a tag off a room → it moves and stays put; the polygon does
    not move. Double-click the moved tag → snaps back to centroid.
  - Draw tool: clicking where a tag sits still places a vertex (drag does not
    fire) — the draw-inside-polygon fix is intact.
  - Save Project → JSON areas contain `labelOffset` for moved tags; Open Project
    restores the moved positions.
