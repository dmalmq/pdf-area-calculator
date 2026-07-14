# Multi-select + Snap-while-drawing — Design

Approved 2026-07-14.

## Feature 1: Marquee multi-select + group move (edit tool)

### State (`state/types.ts`, `state/store.ts`)

- `selectedAreaId: string | null` is REPLACED by `selectedAreaIds: string[]` (single source of truth; no sync invariant).
  - Primary selection = last element; exported selector `primaryAreaId(state)` for the Inspector and single-area consumers.
- Actions:
  - `selectArea(id: string | null)` — kept; sets `selectedAreaIds` to `[id]` or `[]`.
  - `selectAreas(ids: string[])` — replaces the selection.
  - `toggleAreaSelected(id: string)` — shift-click membership toggle.
  - `setAreasGeometry(entries: Array<{ id; polygon; holes? }>)` — one `set` for group moves (one undo step via the existing `beginInteraction`/`endInteraction` bracket).
  - `deleteAreas(ids: string[])` — Delete key removes the whole selection.
  - `copySelectedArea()` now copies every selected area.
- Every store site that cleared/reconciled `selectedAreaId` (load, page change, delete, import, paste, undo/redo, detail editor) clears/filters `selectedAreaIds` instead.

### Stage interactions (`components/PdfStage.tsx`, edit tool)

- Pointer-down on empty canvas starts a **marquee**: dashed rect overlay; on release select all areas on the page whose polygon intersects the rect (vertex-in-rect, rect-corner-in-polygon, or edge crossing). Shift+marquee adds to the selection. Replaces the "Select an area to edit" toast.
- **Shift+click** on an area body toggles it in/out of the selection.
- Dragging the body of a selected area moves **all** selected areas (axis lock via Shift still applies). Drag captures start geometries; each move applies the delta from the starts via `setAreasGeometry`.
- All selected areas render with the selected style; vertex handles/midpoints only when exactly one is selected. Multi-vertex editing is out of scope.

## Feature 2: Snap while drawing

### Vector extraction (`pdf/vectorLines.ts`)

- Per page, lazily walk `page.getOperatorList()` (pdf.js 4.10: `constructPath(opsArr, argsArr, minMax)` packing) tracking the CTM stack (`save`/`restore`/`transform`, `paintFormXObjectBegin/End`), collecting painted path segments in PDF user space. Rects → 4 edges; béziers flattened to chords; clip-only paths (followed by `endPath`) skipped.
- Segment cap ~60k with a `truncated` flag; scanned PDFs yield zero segments and snapping falls back to drawn shapes.
- Cached per `PDFPageProxy` (WeakMap).

### Snap resolution (`geometry/snap.ts`, pure + unit-tested)

- `SegmentIndex` — uniform grid hash over segments; radius query at the cursor.
- `resolveSnap({ pt, tolerance, targets, index, extraSegments, extraPoints })` → `{ pt, kind } | null`.
  - Tiers by priority: **endpoint** (segment endpoints + extra points) → **intersection** (pairwise among nearby segments, on demand) → **line** (nearest point on segment). First enabled tier with a hit within tolerance wins; nearest within tier.
- Tolerance ≈ 10 screen px converted to PDF pt (`/ (viewport.scale * zoom)`).
- Target pool = PDF segments + drawn areas' edges/vertices + current draft vertices. During vertex drag the dragged area's own geometry is excluded (prevents self-lock).

### UI + behavior

- Store (session-only, not persisted, not undoable): `snapEnabled: boolean`, `snapTargets: { endpoints, intersections, lines }` + setters. Defaults: all on.
- Toolbar: Snap toggle + per-type checkboxes in a popover; i18n like the rest.
- Snap applies to: draw clicks + hover preview, hole drawing, calibration clicks, vertex drag in edit mode. **Alt held = snap off.**
- Marker at the snapped point: square = endpoint, × = intersection, tick = on-line.

## Testing

Unit specs: marquee polygon/rect intersection, `setAreasGeometry`/selection actions, snap tier priority + tolerance math, operator-list walker on synthetic op streams. Manual smoke in the running app.
