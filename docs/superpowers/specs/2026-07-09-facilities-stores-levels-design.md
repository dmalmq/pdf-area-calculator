# Facilities, Stores & Per-Level Reporting — Design

**Date:** 2026-07-09
**Status:** Approved

## Problem

The app currently measures polygons assigned to a "business" name and reports one
flat table of business → area (m²) → polygon count. Three gaps:

1. The domain term is **facility (施設名)**, not "business".
2. Each page is a building **level** (B1F, 1F, 2F…) but the report is not broken
   down by level.
3. Inside a facility there are individual **stores/rooms** that need to be
   **counted** (each with a code like `ts001`), reported per facility and per
   floor. Stores are drawn as polygons but are **count-only — never measured**.

## Goals

- Rename the "business" concept to **facility (施設名)** across UI and report.
- Support two kinds of drawn area: **facility** (measured, m²) and **store**
  (counted only, carries a code, belongs to a facility).
- Auto-number store codes from a per-facility prefix; keep codes editable.
- Use each page's label as its **level**; group the report by level.
- Generate a three-section report: by level, by facility, by facility × level.
- A facility may span multiple floors (facility polygons on several pages).
- Show a movable **facility legend** on each page (color swatch + 施設名 for every
  facility present on that page), positioned once and reused on all pages, both
  live on the canvas and baked into the exported PDF.

## Non-goals

- Measuring store area (stores contribute **count only**).
- Spatial auto-assignment of stores to facilities (assignment is via the active
  facility, explicit).
- OS-clipboard interop, multi-select.
- Renaming a facility globally in one action (not currently supported for names;
  out of scope here).

## Data model

### Area

`Area` (in `state/types.ts`) gains `kind` and store fields:

```ts
export type AreaKind = 'facility' | 'store'

export interface Area {
  id: string
  pageIndex: number
  kind: AreaKind        // NEW
  name: string          // facility: its 施設名; store: the PARENT facility's 施設名
  code?: string         // store only, e.g. "ts001" (editable)
  polygon: Pt[]
}
```

- A store's parent facility is its `name` (reusing the existing name-keyed
  grouping, so a facility's color is shared by its stores).
- `code` is undefined for facilities.

### Facility metadata

Facilities remain identified by name. Alongside the existing `names: string[]`
and `colors: Record<string, string>`, add:

```ts
prefixes: Record<string, string>   // facility name → store-code prefix (e.g. "ts")
```

`prefixes` is part of `AppState` and persisted in `ProjectFile`. An unset/empty
prefix is allowed (codes become just the zero-padded number).

### Legend state

Two more fields on `AppState`, both persisted in `ProjectFile`:

```ts
legendPos: Pt | null      // top-left corner of the legend, in PDF points (bottom-left origin); null = default placement
legendVisible: boolean    // show/hide the legend (default true)
```

One `legendPos` is shared by all pages. `null` renders at a default spot (top-left
of the page, ~24pt inset); the first drag stores a concrete `Pt`.

### Project file & migration

`ProjectFile.version` bumps from `1` to `2`. Backward compatibility on load
(`importProject`):

- Any area missing `kind` → default `kind: 'facility'` (and `code` stays
  undefined). This makes every v1 area a facility, preserving current behavior.
- Missing `prefixes` → default `{}`.
- Missing `legendPos` → `null`; missing `legendVisible` → `true`.
- `version` is written as `2` on save; a loaded `version: 1` (or absent) is
  accepted and migrated in memory as above.

`saveProject` adds `prefixes`, `legendPos`, `legendVisible`, and `version: 2` to
the written object.

## Store code generation

`nextStoreCode(state, facilityName): string`:

- `prefix = state.prefixes[facilityName] ?? ''`
- `n = 1 + max ordinal among existing store codes for that facility`, where the
  ordinal is the number read from each store's `code` after stripping the
  facility prefix and ignoring any non-numeric suffix (e.g. an edited `ts002A`
  counts as ordinal 2). Codes with no digits are ignored for max. Start at `1`
  when none exist.
- Return `prefix + String(n).padStart(3, '0')` (e.g. `ts001`, `ts012`).

Codes are editable per store in the sidebar. Editing does not enforce global
uniqueness (the user may intentionally use suffixes like `ts001A`), but
auto-numbering always advances past the highest numeric ordinal so fresh stores
don't collide.

## Store actions (store.ts)

- `setDrawKind(kind: AreaKind): void` — sets the active draw kind (state:
  `drawKind: AreaKind`, initial `'facility'`).
- `addArea(area)` — existing; now also accepts `kind`/`code`. Facility areas
  register the name/color as today. Store areas register the parent facility
  name/color too (so a store drawn under a not-yet-registered facility still
  shows correctly), and require a non-empty `name` (parent) and ≥3 vertices.
- `setFacilityPrefix(name: string, prefix: string): void` — sets
  `prefixes[name]` (trimmed).
- `setStoreCode(id: string, code: string): void` — sets a store area's `code`
  (trimmed); no-op on a facility area or unknown id.
- `nextStoreCode(state, facilityName)` — pure helper (exported) used by the
  drawing flow.

## Aggregation & report data (store.ts)

Replace/extend the current `aggregate` with kind-aware selectors. New/updated
pure functions operating on `Pick<AppState, 'areas' | 'pages' | 'names'>`:

- `facilityAreaM2(state, area)` — unchanged m² for a single facility polygon
  (already exists as `areaM2`); returns null on unscaled pages.
- `reportByLevel(state): LevelRow[]` where
  `LevelRow = { level: string; areaM2: number; unscaledPt2: number; facilities: number; stores: number }`.
  Grouped by `pages[pageIndex].label`. `areaM2`/`unscaledPt2` sum only
  `kind:'facility'` polygons; `facilities` = distinct facility names with a
  facility polygon on that level; `stores` = count of `kind:'store'` areas on
  that level.
- `reportByFacility(state): FacilityRow[]` where
  `FacilityRow = { name: string; areaM2: number; unscaledPt2: number; levels: string[]; stores: number }`.
  `areaM2` sums the facility's facility polygons across all pages; `levels` =
  sorted distinct labels of pages where the facility has any area (facility or
  store); `stores` = count of that facility's store areas.
- `reportByFacilityLevel(state): FacilityLevelRow[]` where
  `FacilityLevelRow = { name: string; level: string; areaM2: number; unscaledPt2: number; stores: number }`.
  One row per (facility, level) that has any area; sorted by facility then level.

Level ordering: pages are already ordered; derive level order from first page
index at which each label appears, so B1F/1F/2F come out in page order.

Unscaled handling mirrors today: pages without a scale contribute `unscaledPt2`
instead of `areaM2`; the existing "unscaled" confirm in `generateReport` stays.

## Drawing flow & UI

### Draw-kind toggle

A Facility/Store toggle near the tools (Toolbar). Bound to `drawKind` /
`setDrawKind`. Keyboard: extend shortcuts (e.g. `F` = facility kind, `S` = store
kind) and add overlay rows.

### Active facility

The existing active-name selector becomes the **active facility** (label
"施設名"). Drawing:

- **Facility kind:** on close, create `{ kind:'facility', name: activeName, … }`
  (current behavior, just tagged). Requires an active facility name (existing
  "Select or add a business name first" → reworded "Select or add a facility
  first").
- **Store kind:** on close, require an active facility; create
  `{ kind:'store', name: activeName, code: nextStoreCode(state, activeName), … }`.
  No active facility → toast "Select a facility first".

### Canvas labels (PdfStage)

- Facility polygon: `施設名` name + m² (as today).
- Store polygon: its `code` (single line), in the facility color.

### Sidebar

- Heading "Businesses" → "施設名".
- Each facility chip gains a small **prefix** input (sets `prefixes[name]`).
- "Areas on page" splits visually into facilities and stores, or shows a `kind`
  badge and, for stores, the editable `code` and parent facility. The selected
  panel shows `code` (stores) or name (facilities) and allows editing.

### Levels

`PageState.label` is the level. Keep the Scale-panel editor; also show the label
in the Toolbar page indicator (e.g. `1F · Page 2/5`).

## Facility legend

A legend box listing every facility present on the current page, shared position
across all pages, shown live and baked into the export.

### Membership

`facilitiesOnPage(state, pageIndex): { name: string; color: string }[]` — distinct
facility names that have **any** area (facility polygon **or** store) on that
page, each with its resolved color (`colorForBusiness`), sorted by first
appearance in `names`. Pages with no areas render no legend.

### Layout

Auto-sized box: a title-less stack of rows, each `[color swatch] 施設名`. Width =
longest name + swatch + padding; height = `rows × rowH + padding`. Light
background, subtle border. `legendPos` is the box's top-left corner.

### Live canvas (PdfStage)

- When `legendVisible` and the page has facilities, draw the legend on the
  overlay (vector: rounded rect, swatches, names) at `legendPos` (converted from
  PDF points to viewport; `null` → default top-left inset).
- **Draggable:** a new `DragState` kind `'legend'`. In `onPointerDown`, a hit-test
  against the legend bounds runs **before** the draw/edit branches (but after the
  pan check), so the legend can be grabbed and moved in any tool without placing a
  vertex. Drag updates `legendPos` (absolute-from-start off the pointer's PDF
  point, mirroring area drag). Gated on the `moved` threshold.

### Export (buildReport)

- New `renderLegendPng(entries): Uint8Array` (in `report/legendImage.ts`,
  analogous to `tableImage.ts`) renders the legend to a PNG via canvas — this
  keeps CJK facility names rendering correctly (pdf-lib's standard fonts lack
  Japanese glyphs, so the legend is embedded as an image, not `drawText`).
- In `buildReportPdf`, for each page with facilities (and when `legendVisible`),
  render that page's legend PNG and `drawImage` it at `legendPos` — converting the
  stored top-left PDF point to pdf-lib's bottom-left origin using the image's
  point height (fixed points-per-row). `null` → the same default inset used on
  canvas.

### Store actions

- `setLegendPos(pos: Pt): void`
- `setLegendVisible(visible: boolean): void` (a toggle in the Toolbar, default on)

## Copy/paste interaction

The merged copy/paste feature must carry the new fields:

- Copying an area copies `kind` and `code`.
- Pasting a **facility** keeps its `name` (and the facility's prefix already
  lives in `prefixes`).
- Pasting a **store** keeps its parent `name` but is **re-coded** via
  `nextStoreCode` for that facility on paste, so duplicate codes are not
  introduced. (If multiple stores are pasted, each advances the counter.)

## Error / edge handling

- Store draw with no active facility → toast, no area created.
- Facility draw with no active facility name → existing toast, no area created.
- Store `code` is trimmed on edit. An empty code is permitted (the user may
  clear it deliberately); auto-numbering for the next new store still advances
  past the highest numeric ordinal among that facility's non-empty codes.
- Unscaled pages: stores still count; facility area falls to `unscaledPt2`.

## Testing

Store unit tests (`state/store.spec.ts`):

- `addArea` tags kind; store areas register parent name/color.
- `nextStoreCode`: first code is `prefix001`; advances past the max numeric
  ordinal; ignores non-numeric suffixes for the max; empty prefix → just digits.
- `setFacilityPrefix` / `setStoreCode` behavior and no-ops.
- `reportByLevel` / `reportByFacility` / `reportByFacilityLevel`: m² only from
  facility polygons, store counts correct, multi-floor facility spans, level
  ordering by page order, unscaled handling.
- v1→v2 migration: areas without `kind` load as facilities; missing `prefixes`
  defaults to `{}`; missing `legendPos`/`legendVisible` default to `null`/`true`.
- Copy/paste: pasted store is re-coded; pasted facility keeps its name.
- `facilitiesOnPage`: includes a facility with only a store on the page; distinct,
  color-resolved, ordered by `names`; empty for a bare page.

Report-builder tests (`report/*.spec.ts`): the three sections render with correct
grouped values; existing report tests updated for the new header/term.
`renderLegendPng` produces a non-empty PNG for a set of entries (smoke test,
mirroring existing `tableImage.spec.ts`).

## Implementation phasing (one spec, phased plan)

1. **Data model + migration + store logic** — types, `kind`/`code`/`prefixes`,
   migration, `nextStoreCode`, kind-aware aggregation selectors, unit tests.
2. **Drawing & UI** — draw-kind toggle, active-facility rewording, store drawing
   with auto-code, canvas store labels, sidebar prefix/code editing, level in
   toolbar, copy/paste field carry + re-code.
3. **Report** — three-section report data + canvas renderer + tests.
4. **Facility legend** — `facilitiesOnPage` selector, `legendPos`/`legendVisible`
   state + actions + migration, draggable overlay legend, `renderLegendPng`, and
   per-page legend embedding in the export.

## Out of scope / future

- Global facility rename, spatial store→facility assignment, store measurement.
