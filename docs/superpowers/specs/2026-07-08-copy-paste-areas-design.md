# Copy/Paste Areas + Drag-to-Move — Design

**Date:** 2026-07-08
**Status:** Approved

## Problem

When several floors share the same building outline, a user must re-trace the
same polygon on every page. There is no way to reuse an existing area, and no
way to reposition an area after it is drawn (only individual vertices can be
moved via the Edit tool).

## Goals

- Copy the selected area, or all areas on the active page, to a session clipboard.
- Paste copied areas onto the active page at identical PDF-point coordinates so
  identical floor shapes align exactly across pages.
- Drag a whole area to reposition it (Edit tool), with an optional axis lock.
- Trigger via both keyboard shortcuts and buttons.

## Non-goals

- Persisting the clipboard to the project file.
- Cross-application clipboard (OS clipboard) integration.
- Multi-select of areas (the app remains single-selection).

## Data model

Add a session clipboard to `AppState` (store only — **not** part of `ProjectFile`):

```ts
export interface CopiedArea {
  name: string
  polygon: Pt[]
}
```

- `AppState.clipboard: CopiedArea[]` — initial value `[]`.
- Copied areas strip `id` and `pageIndex`; only `name` + `polygon` are retained.
- `ProjectFile` is unchanged, so Save/Open Project ignore the clipboard.
- `loadDocument` uses a shallow `set({...})` that does not mention `clipboard`,
  so the clipboard survives opening a new document (zustand shallow-merges).

## Store actions

All new actions live in `createAreaStore` (`state/store.ts`):

- `copySelectedArea(): number`
  Copies the currently selected area (by `selectedAreaId`) into `clipboard` as a
  single-element array. Returns the number copied (`1`, or `0` if nothing
  selected). Polygon is deep-cloned.

- `copyActivePage(): number`
  Copies every area whose `pageIndex === activePageIndex` into `clipboard`.
  Returns the count (`0` if the page has no areas; clipboard left unchanged when
  count is 0).

- `pasteClipboard(): number`
  For each `CopiedArea` in `clipboard`, appends a new `Area` with
  `id = crypto.randomUUID()`, `pageIndex = activePageIndex`, the copied `name`,
  and a deep-cloned `polygon`. Registers each name/color via the existing
  `withName` / `withNameColor` helpers. Selects the last pasted area
  (`selectedAreaId`). Returns the count pasted (`0` if the clipboard is empty).

- `setAreaPolygon(id: string, polygon: Pt[]): void`
  Replaces the polygon of the area with the given `id`. Single primitive used by
  drag-to-move (absolute set makes axis-lock straightforward). No-op if the id is
  unknown.

Copy/paste return counts so the UI layer (App) can show toasts; the store never
shows toasts itself.

## Drag-to-move (Edit tool)

Extend the stage's `DragState` with a new `kind: 'area'` that carries:

- `areaId: string`
- `startPt: Pt` — the PDF-point under the pointer at drag start.
- `startPolygon: Pt[]` — the area's polygon captured at drag start.

Pointer handling in `PdfStage` (Edit tool only), on pointer-down that is **not**
on a vertex and **not** on an edge midpoint:

1. `findAreaAt(pdfPt)` → if an area is hit:
   - Select it if it is not already selected; clear `selectedVertex`.
   - Start an `'area'` drag capturing `startPt` and a clone of `startPolygon`.
2. If no area is hit: clear `selectedVertex` (existing behavior).

On pointer-move for an `'area'` drag:

- `total = { x: pdfPt.x - startPt.x, y: pdfPt.y - startPt.y }`
- If `event.shiftKey`: lock to the dominant axis —
  if `|total.x| >= |total.y|` set `total.y = 0`, else set `total.x = 0`.
- `next = startPolygon.map(p => ({ x: p.x + total.x, y: p.y + total.y }))`
- `setAreaPolygon(areaId, next)`

Using `startPolygon + total` (absolute) rather than incremental deltas keeps the
axis lock stable when Shift is pressed/released mid-drag.

Drag-to-move is scoped to the **Edit** tool. In Draw tool, clicking an area still
only selects it, to avoid interfering with tracing.

## Triggers / UI

**Keyboard** (added to the existing global handler in `App.tsx`; the handler
already returns early for INPUT/SELECT/TEXTAREA so native copy/paste in text
fields is unaffected):

- `Ctrl/Cmd+C` — contextual: if an area is selected → `copySelectedArea()`,
  else → `copyActivePage()`. Toast reports the count (or "No areas to copy").
- `Ctrl/Cmd+V` — `pasteClipboard()`. Toast reports the count (or "Nothing to
  paste").

**Buttons** (`Sidebar.tsx`):

- Selected-area panel: **Copy** → `copySelectedArea()`.
- "Areas on page" panel header: **Copy all** → `copyActivePage()`, and
  **Paste** → `pasteClipboard()` (disabled when `clipboard.length === 0`).

**Shortcuts overlay** (`App.tsx` `shortcutRows`): add rows for
`Ctrl/Cmd+C` (copy area / page) and `Ctrl/Cmd+V` (paste), plus a note that
dragging an area body in Edit moves it (Shift locks the axis).

## Error / edge handling

- Copy with nothing selected and an empty page → clipboard unchanged, toast
  "No areas to copy".
- Paste with empty clipboard → no-op, toast "Nothing to paste".
- Paste onto the same page overlaps the original at identical coordinates; the
  pasted area is auto-selected (thicker stroke) so it is visibly present and
  ready to drag.
- Deep-clone polygons on both copy and paste so later edits never mutate the
  clipboard or the source area.

## Testing

Unit tests in `state/store.spec.ts`:

- `copySelectedArea` copies the selected area and returns 1; returns 0 with no
  selection.
- `copyActivePage` copies only active-page areas and returns the count.
- `pasteClipboard` creates areas with fresh ids, `pageIndex === activePageIndex`,
  preserved names, registers new names/colors, selects the last, returns count;
  returns 0 on empty clipboard.
- Paste polygons are independent clones (mutating a pasted area does not affect
  the clipboard or the original).
- `setAreaPolygon` replaces the target polygon and no-ops on unknown id.

Drag math (axis lock) is simple enough to cover by asserting the `startPolygon +
constrained-delta` computation if factored into a small pure helper; otherwise it
is exercised manually.

## Out of scope / future

- OS clipboard interop, multi-select, paste-with-offset presets.
