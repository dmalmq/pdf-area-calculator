# Undo/Redo, Kind-Swap, and Interior Rings — Design

**Status:** Approved
**Target:** `C:/Repositories/pdf-area-calculator`

Three features. No new dependencies. `ProjectFile.version` stays `1|2` (new `holes` is optional, like `labelOffset`).

## 1. Multi-step undo / redo

In-house history in `areaStore`, reusing `toProjectFile` as the snapshot slice (so it captures exactly the persisted edit domain: pages, areas incl. `holes`/`kind`/`code`, names, colors, prefixes, legend\*, storeLabelMode — and excludes tool/zoom/pan/selection).

- State (session, not persisted): `undoStack: string[]`, `redoStack: string[]` (JSON snapshots), capped at 50.
- `createAreaStore` holds closure flags `suppressHistory` and `interaction: { before: string } | null`, and subscribes to itself:
  - On each change, if `suppressHistory || interaction` → return. Else if the edit slice changed (cheap reference compare of areas/pages/names/colors/prefixes/legend\*/storeLabelMode via `editStateChanged`) → push `JSON.stringify(toProjectFile(prev))` to `undoStack` (capped), clear `redoStack`. The push itself is wrapped in `suppressHistory`.
- Actions: `undo()`, `redo()`, `beginInteraction()`, `endInteraction()`.
  - `undo`/`redo` restore the toProjectFile fields via `set` (wrapped in `suppressHistory`), move the current snapshot to the opposite stack, then reconcile selection (`selectedAreaId` cleared if its area no longer exists).
  - `beginInteraction` captures `interaction.before = snapshot(now)`; `endInteraction` pushes it once (if the slice actually changed) and clears — this coalesces a whole drag into ONE step.
- `loadDocument`/`importProject` wrap their `set` in `suppressHistory` and clear both stacks (history does not cross documents).
- Coverage: discrete edits (add/delete/rename/vertex insert-remove/kind-swap/hole add-remove/scale/legend/renumber/paste) auto-recorded by the subscriber (one step each). Drags (area/vertex/label/legend) coalesced via begin/endInteraction from `PdfStage`. Pan/zoom/tool/page/selection never recorded.
- UI: toolbar undo/redo buttons (enabled from `undoStack.length`/`redoStack.length`), `Ctrl/Cmd+Z` = undo, `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` = redo (App keyboard handler; suppressed while a modal is open and inside inputs, as today).
- Supersedes the current bespoke 8-second delete-undo (removed).

## 2. Swap facility ⇄ store

New store action `setAreaKind(id: string, kind: AreaKind): void`:

- unknown id or same kind → no-op.
- facility → store: `{ ...area, kind: 'store', code: nextStoreCode(state, area.name) }` (name kept — it is already the facility key).
- store → facility: `{ ...area, kind: 'facility', code: undefined }`.
  Undoable (subscriber records it). UI: the Selection inspector's kind heading becomes a `種類 / Type` segmented control (`施設`/`店舗`) bound to `setAreaKind(selected.id, …)`. Aggregates already key off `kind`, so measurement/count membership flips immediately.

## 3. Interior rings (holes)

Additive model — `Area.holes?: Pt[][]` and `CopiedArea.holes?: Pt[][]` (outer `polygon` unchanged). Missing/empty ⇒ solid.

### Geometry (`geometry/area.ts`)

- Keep `shoelacePt2`, `areaToM2`, `pointInPolygon`, `polygonCentroid`.
- Add `areaNetPt2(area: { polygon: Pt[]; holes?: Pt[][] }): number = Math.max(0, shoelacePt2(polygon) - sum(holes.map(shoelacePt2)))`.
- Add `pointInArea(area, p): boolean = pointInPolygon(p, polygon) && !(holes ?? []).some(h => pointInPolygon(p, h))`.

### Store (`state/store.ts`)

- `areaM2` → `areaToM2(areaNetPt2(area), mmPerPtFor(state, area.pageIndex))`.
- `aggregate` / `addFacilityArea` / report facility m² → net area.
- `cloneHoles(holes?)` deep-clone; used in `copySelectedArea`, `copyActivePage`, `pasteClipboard`, and `importProject` (which currently omits `holes` — must map it).
- New actions: `addHole(id: string, ring: Pt[]): void` (append a hole ring, ≥3 pts, to a store/facility area), `removeHole(id: string, holeIndex: number): void`.
- Vertex mutators (`moveVertex`/`insertVertex`/`removeVertex`) stay **outer-only** (v1: no hole-vertex editing). `setAreaPolygon` stays outer replace; area-drag translates holes too via a new `setAreaGeometry(id, polygon, holes)` OR by passing holes — see Canvas.

### Canvas (`components/PdfStage.tsx`) — surgical, engine intact

- `drawPolygon`: after the outer subpath, add each hole as a `moveTo/lineTo/closePath` subpath and fill with `ctx.fill('evenodd')`; stroke outer + each hole.
- Hit-test: `findAreaAt` uses `pointInArea` (hole interior counts as outside).
- Area body drag: capture `startHoles` (clone) at drag start; on move translate outer + holes by the same delta via `setAreaGeometry`.
- Draw-hole mode: local `holeDraftFor: string | null` (the target area id). Entered from the inspector "穴を追加" for the selected area; reuses the existing draft/hover/close pipeline; `closeDraft` branches: if `holeDraftFor` set → `addHole(holeDraftFor, draft)` and exit mode, else existing `addArea`. Draft stroke tinted differently in hole mode.
- Undo: call `beginInteraction()` when starting vertex/area/label/legend drags; `endInteraction()` in `onPointerUp` and `onPointerCancel`.
- Vertex handles/hit stay outer-only.

### Export (`report/buildReport.ts`)

- `drawAreaOverlays`: build `svgPath(outer) + holes.map(h => svgPath([...h].reverse())).join(' ')` — reversed holes so pdf-lib's nonzero fill punches them out; border strokes all rings. Store-label centroid stays outer.

### UI (`InspectorPanel` Selection tab)

- Kind toggle (see feature 2).
- "穴を追加 / Add hole" button → enters hole-draw mode for the selected area.
- Holes list: `穴 1 [削除] …` each calling `removeHole(selected.id, i)`.
- Measure uses `areaNetPt2` (fix the `shoelacePt2(polygon)` fallbacks in Inspector ~89 and Sidebar ~164).

## Edge cases

- Unscaled area with holes → net pt² into `unscaledPt2`.
- Centroid may land in a courtyard → tag draggable via `labelOffset` (unchanged). No auto pole-of-inaccessibility in v1.
- Hole with <3 pts on close → rejected (no-op). Overlapping/oversized holes → area clamped to ≥0; not validated in v1.
- Store may carry holes (geometry is kind-agnostic); stores stay count-only in reports.
- Delete is now instant + undoable; renumber keeps its confirmation.

## Verification

`npm run typecheck` · `npx vitest run` (+ new: net area, pointInArea, holes clone/import, setAreaKind, addHole/removeHole, undo/redo push/restore/coalesce/clear-on-load) · `npm run lint` (no new errors) · `npm run build` · GUI smoke + real-data check against `SendaiStation-oversize_project.json` (undo a delete/move; swap a kind; add a hole and confirm net area drops).
