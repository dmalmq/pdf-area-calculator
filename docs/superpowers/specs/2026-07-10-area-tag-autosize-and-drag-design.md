# Auto-sized, draggable area tags + store-tag display mode

## Problem

Each area on the canvas draws a "tag" at its polygon centroid:

- **Facility** tags show two lines: the facility name and its area (`<n> m²`, or `unscaled`).
- **Store** tags show one line: the store code (e.g. `S本館001`).

Three problems:

1. **Overflow** (on-canvas) — the tag box is a fixed `116×40` px rectangle. Long
   facility names render wider than the box, so text spills outside the tag.
2. **No repositioning** (on-canvas) — a tag sits at the centroid and can cover an
   underlying room the user needs to see. There is no way to move it.
3. **Store tags dominate at working zoom** — a full store code like `S本館001`
   is nearly as large as the store polygon, so a page of stores becomes a wall of
   codes. The user wants store tags to be toggleable and to optionally show just
   the number (`1`, `2`, `3`).

## Scope (decided)

- **Overflow fix**: auto-size the tag box to its text (grow the box; no wrapping,
  no font shrinking).
- **Move**: tags are draggable in the **Edit tool**; moved positions **persist**
  in the project file; **on-canvas view only** (the export is unaffected by moves).
- **Store-tag display mode**: a `storeLabelMode` of `code | number | off`,
  persisted, set from a 3-way toolbar control. Applies to **both** the on-canvas
  store tags **and** the exported PDF's in-place store codes.
  - `code` → full code (today's behavior; default)
  - `number` → the numeric part of the code as an integer (`S本館007` → `7`)
  - `off` → no store tag drawn

### Out of scope

- Facility tags are unchanged by the store-tag mode (still always show name + m²).
  Facility tags are still auto-sized and draggable.
- The exported report's **summary page** (`report/reportImage.ts`) is unchanged —
  it aggregates counts/m², not per-store codes.
- Line wrapping / font auto-shrinking for long names.
- Scaling the tag with zoom. Tags stay a fixed screen size (as today); only the
  box dimensions change from fixed to measured.
- Moving a tag does **not** move the exported store code (export uses the centroid).

## Design

Changes span `types.ts`, a new pure helper module, `store.ts`, `App.tsx`,
`components/PdfStage.tsx`, `components/Toolbar.tsx`, and `report/buildReport.ts`.

### 1. Auto-sized tag box (on-canvas)

Tag layout constants and a pure sizing helper, both module-level in `PdfStage.tsx`:

```ts
const TAG = { font: 13, weight: 600, lineH: 15, padX: 10, padY: 8 }

// Box (screen px) sized to its text: widest line + horizontal padding both
// sides; one line-height per line + vertical padding. Auto-grows so long names fit.
export function tagBoxSize(lineWidths: number[]): { width: number; height: number } {
  return {
    width: Math.max(0, ...lineWidths) + TAG.padX * 2,
    height: lineWidths.length * TAG.lineH + TAG.padY * 2
  }
}
```

Two shared helpers remove duplication between drawing and hit-testing:

- `tagLines(area, state): string[]` — the lines for an area. Facility →
  `[name, areaM2 == null ? 'unscaled' : '<n> m²']`. Store → `storeTagLabel(...)`
  wrapped as `[label]`, or `[]` when the label is `null` (mode `off`).
- `tagRect(area, ctx, viewport, state): { x, y, w, h, lines } | null` — returns
  `null` when `tagLines` is empty (an `off` store), otherwise the tag's screen-px
  rectangle (centroid + `labelOffset` → viewport px, auto-sized, centered) plus the
  lines to draw. Shared by the draw path and hit-testing so the drawn box and the
  grabbable box are identical.

The draw path in `drawPolygon` draws only when `tagRect` returns non-null, using
`rect.lines` centered at `rect.x + rect.w/2`,
`rect.y + TAG.padY + TAG.lineH/2 + i*TAG.lineH`. Colors unchanged (dark `#111827`
fill, white stroke, white text). This replaces the hard-coded `±58/±20/116/40`
math.

### 2. Store-tag label helper (shared by canvas + export)

New leaf module `src/renderer/src/state/storeLabel.ts` (depends only on `types.ts`,
so both `PdfStage.tsx` and `report/buildReport.ts` can import it without coupling):

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

This mirrors the prefix-strip + `/\d+/` approach already in `nextStoreCode`.

### 3. State, actions, persistence

`types.ts`:

- `Area.labelOffset?: Pt` — tag position as a delta from the centroid, in PDF
  points; absent = centroid. A delta so the tag follows the polygon on move/reshape.
- `export type StoreLabelMode = 'code' | 'number' | 'off'` (next to `LegendOrientation`).
- `AppState.storeLabelMode: StoreLabelMode`.
- `ProjectFile.storeLabelMode?: StoreLabelMode` (optional; no version bump).
- `Area.labelOffset` flows into `ProjectFile.areas` automatically (typed
  `Array<Omit<Area, 'kind'> & …>`).

`store.ts`:

- `initialState.storeLabelMode: 'code'`.
- `AreaStore` gains `setAreaLabelOffset(id: string, offset: Pt): void` and
  `setStoreLabelMode(mode: StoreLabelMode): void`; `importProject`'s parameter type
  gains optional `labelOffset` (via the area type) and `storeLabelMode?`.
- `setAreaLabelOffset` maps the offset onto one area (mirrors `setAreaPolygon`).
- `setStoreLabelMode` sets the field.
- `importProject` maps `labelOffset: area.labelOffset` per area and
  `storeLabelMode: project.storeLabelMode ?? 'code'`.

`App.tsx`:

- `saveProject` adds `storeLabelMode: state.storeLabelMode` (areas — hence
  `labelOffset` — are already serialized whole).
- `generateReport` passes `{ mode: state.storeLabelMode, prefixes: state.prefixes }`
  to `buildReportPdf`.

### 4. Drag interaction (Edit tool only) + reset

`DragState` gains `kind '… | 'label'` and `startLabelOffset?: Pt`. A
`findTagAt(viewportPoint): Area | null` helper iterates `pageAreas` top-most first
and returns the first area whose `tagRect` (non-null) contains the point.

- **onPointerDown**, top of the `tool === 'edit'` branch (before the vertex hit):
  if `findTagAt` hits, start a label drag
  (`kind: 'label', areaId, startPt: pdfPt, startLabelOffset: area.labelOffset ?? {0,0}`)
  and return. Does not change selection.
- **onPointerMove**, new `drag.kind === 'label'` branch (mirrors legend): past the
  `moved` threshold, `setAreaLabelOffset(areaId, startLabelOffset + (pdfPt - startPt))`.
- **onDoubleClick**: when `tool === 'edit'`, if `findTagAt` hits, reset that area's
  offset to `{0,0}` and return; else fall through to existing behavior.

Why Edit-only: Draw-tool clicks must place vertices (including inside a polygon —
the shipped draw-inside-polygon fix); stealing them for tag drags would reintroduce
that bug. Pan pans. Legend drag keeps its existing priority.

### 5. Toolbar control

`Toolbar.tsx` gains a "Store tags" group (mirrors the legend Vertical/Horizontal
buttons): **Code / Number / Off**, each `is-active` when it matches `storeLabelMode`,
calling `setStoreLabelMode`.

### 6. Export follows the mode

`report/buildReport.ts` `drawAreaOverlays` takes `{ mode, prefixes }` and draws the
in-place store label via `storeTagLabel(area.code, prefixes[area.name], mode)` —
skipping when it returns `null` (mode `off`), drawing the number when `number`.
`buildReportPdf` gains a trailing
`storeLabels: { mode: StoreLabelMode; prefixes: Record<string, string> } = { mode: 'code', prefixes: {} }`
parameter, so existing callers (and `buildReport.spec.ts`) keep today's `code`
behavior with no change. Facility polygons remain unlabeled in place.

Note: `number` mode yields ASCII digits, safe for the standard Helvetica code font.
Rendering full non-ASCII codes (`code` mode with a Japanese prefix) in the export is
a pre-existing standard-font limitation and is unchanged by this work.

## Testing

- `state/storeLabel.spec.ts` — `storeTagLabel`:
  - `('S本館007', 'S本館', 'code')` → `'S本館007'`
  - `('S本館007', 'S本館', 'number')` → `'7'` (prefix strip + drop leading zeros)
  - `('S本館007', undefined, 'number')` → `'7'` (first digit run works without prefix)
  - `('ts002A', 'ts', 'number')` → `'2'` (non-numeric suffix ignored)
  - `('abc', undefined, 'number')` → `'abc'` (no digits → raw fallback)
  - `(undefined, 'x', 'code')` → `'—'`; `(undefined, 'x', 'number')` → `'—'`
  - any code, mode `'off'` → `null`
- `components/PdfStage.spec.ts` — `tagBoxSize`:
  - `[40]` → `{60, 31}`, `[120, 30]` → `{140, 46}`, `[]` → `{20, 16}`
- `state/store.spec.ts`:
  - `setAreaLabelOffset(id, {x,y})` sets that area's `labelOffset`, others untouched.
  - `setStoreLabelMode('number')` → `'number'`.
  - `importProject` preserves a supplied `labelOffset` and `storeLabelMode`, and
    defaults them (`undefined` / `'code'`) when omitted.
- `report/buildReport.spec.ts` — existing tests call `buildReportPdf` without the new
  param and rely on the `code` default; no change needed.
- Drag/reset wiring reuses the existing `DragState` pattern; pure helpers carry the
  unit coverage.

## Files touched

- `src/renderer/src/state/types.ts` — `Area.labelOffset?`, `StoreLabelMode`,
  `AppState.storeLabelMode`, `ProjectFile.storeLabelMode?`.
- `src/renderer/src/state/storeLabel.ts` — new; `storeTagLabel`.
- `src/renderer/src/state/store.ts` — `initialState`, `setAreaLabelOffset`,
  `setStoreLabelMode`, `importProject` mapping.
- `src/renderer/src/App.tsx` — `saveProject` (`storeLabelMode`), `generateReport`
  (store-label options).
- `src/renderer/src/components/PdfStage.tsx` — `TAG`, `tagBoxSize`, `tagLines`,
  `tagRect`, `findTagAt`; rewritten label draw; `DragState` `'label'`; pointer
  down/move label branches; double-click reset.
- `src/renderer/src/components/Toolbar.tsx` — "Store tags" Code/Number/Off group.
- `src/renderer/src/report/buildReport.ts` — `drawAreaOverlays` + `buildReportPdf`
  store-label option.
- Tests: `state/storeLabel.spec.ts` (new), `components/PdfStage.spec.ts`,
  `state/store.spec.ts`.
- Not touched: `report/reportImage.ts` (summary page), `report/legendImage.ts`.

## Verification

- `npx vitest run` — all pass, including new `storeTagLabel` / `tagBoxSize` /
  `setAreaLabelOffset` / `setStoreLabelMode` / import tests.
- `npm run typecheck` — clean.
- Manual (`npm run dev`, any vector PDF):
  - Long facility name → tag box grows to contain the whole name (no overflow).
  - Edit tool: drag a tag off a room → moves and stays; polygon does not move.
    Double-click the moved tag → snaps back to centroid.
  - Draw tool: clicking where a tag sits still places a vertex (drag does not fire).
  - Store tags: toolbar **Number** → store tags show `1, 2, 3…`; **Off** → store
    tags disappear; **Code** → full codes return. Facility tags unaffected.
  - Generate Report in each mode → the exported PDF's in-place store labels match
    (numbers / hidden / full codes).
  - Save Project → JSON has `labelOffset` (for moved tags) and `storeLabelMode`;
    Open Project restores both.
