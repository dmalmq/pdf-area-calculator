# Facility Detail Pages — Design

**Date:** 2026-07-13
**Status:** Approved

## Problem

The exported report shows each floor at full-page zoom, where individual stores
inside a facility are too small to read. Users manually capture zoomed
screenshots (e.g. Google Maps indoor view) but have nowhere to put them in the
report.

## Goals

- Let the user opt selected **facility × level** combos into a **detail page**:
  a dedicated page inserted after the original pages and before the report-table
  page.
- Each detail page shows the facility's polygon(s) and its stores **zoomed to
  fill the page** (no original PDF underneath), with a header naming the
  facility and level.
- The user can attach an image (clipboard paste or file picker) as a
  **background under the polygons**, and align it with move / scale / rotate so
  the polygons annotate the image.
- Alignment is WYSIWYG: edited on the main canvas in a dedicated detail mode
  that previews exactly what the export renders.

## Non-goals

- Automatic image alignment or georeferencing.
- Multiple images per detail page.
- Detail pages combining several levels of one facility (one page per
  facility × level).
- Measurements on detail pages (no m² labels; stores stay count-only).

## Data model

### Types (`state/types.ts`)

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
  image?: string // PNG, base64 (paste or file picker)
  transform?: DetailTransform // absent until an image is placed
}
```

- `AppState.detailPages: DetailPage[]` — presence in the array = enabled.
  Uniquely keyed by `(name, pageIndex)`.
- The transform lives in **source-page PDF-point space**: the image sits under
  the polygons in the same coordinate system the polygons already use, so the
  live preview and the export share it verbatim and it is independent of output
  page size.
- `AppState.detailEditing: { name: string; pageIndex: number } | null` —
  transient (not persisted), which detail page is being edited on the canvas.

### Project file & migration

- `ProjectFile.version` bumps 2 → 3; `detailPages?: DetailPage[]` added.
- `importProject`: missing `detailPages` → `[]` (existing migration pattern).
- `saveProject` writes `detailPages` and `version: 3`.
- Undo/redo: `detailPages` rides the existing JSON-snapshot undo stack.
  Base64 images make snapshots heavier; acceptable — images change rarely.

### Pruning

Removing a facility's last polygon (facility or store) on a page removes the
stale `DetailPage` for that combo, including its image.

## Store actions & selectors (`state/store.ts`)

- `detailCandidates(state): { name: string; pageIndex: number; level: string; stores: number }[]`
  — pure selector: every (facility, page) combo with any facility or store
  polygon, ordered by facility (per `names`) then page order.
- `setDetailPageEnabled(name, pageIndex, enabled)` — add/remove a `DetailPage`
  (removal drops the image).
- `setDetailImage(name, pageIndex, image: string, transform: DetailTransform)` —
  attach an image with its initial placement.
- `setDetailTransform(name, pageIndex, transform)` — update during drag/scale/rotate
  (wrapped in the existing `beginInteraction`/`endInteraction` for undo batching).
- `removeDetailImage(name, pageIndex)`.
- `openDetailEditor(name, pageIndex)` / `closeDetailEditor()`.

## Selection UI

A collapsible **"Detail pages"** section in `InspectorPanel`: a checkbox list of
`detailCandidates` rows (`施設名 · level · N stores`). Checking enables the
combo; each enabled row shows an **Edit** button that calls `openDetailEditor`
(switching the active page to `pageIndex` first).

## Detail mode (PdfStage)

When `detailEditing` is set, `PdfStage` renders in detail mode:

- The PDF bitmap canvas is hidden (white background). The same page viewport
  and coordinate helpers (`viewportPt`, `eventToPdfPt`) are reused unchanged.
- **Auto-framing:** compute the bbox of the facility's polygons + stores on the
  page, pad 5%, and derive zoom/pan to fit the stage. Framing may differ
  slightly from the export (stage aspect ≠ A4 aspect), but image↔polygon
  alignment is exact in both — the transform lives in PDF-point space.
- **Drawn (in order):** the image (its `DetailTransform`, ~90% opacity), the
  facility outline(s), store outlines, and store tags — the existing overlay
  draw path filtered to this facility's areas. Tags respect `storeLabelMode`.
- Drawing, edit, and calibration tools are disabled in this mode. Esc or a
  "Done" button calls `closeDetailEditor`.

### Image input

- A `paste` listener (active only in detail mode) accepts clipboard image data.
- An "Add image…" button opens a file picker (PNG/JPEG; non-PNG converted to
  PNG on import via canvas).
- Oversized images are downscaled on import to a max dimension of 2000 px
  (pure helper, canvas-based) to keep project files sane.
- Initial placement: centered on the facility bbox, scaled to fit it,
  rotation 0.

### Alignment interaction

New `DragState` kind `'detailImage'` plus wheel handling (all only while in
detail mode):

- Drag anywhere on the image → move.
- Scroll wheel → scale around the cursor.
- Shift+scroll → rotate around the image center (0.5°/notch).
- A floating hint bar shows the controls and a "Remove image" button.

## Export (`report/buildReport.ts`)

In `buildReportPdf`, after overlays/legends on the original pages and before
the report-table page, one page per `DetailPage` in facility-then-level order:

- **Page:** A4; orientation from the facility bbox aspect (landscape when wider
  than tall).
- **Fit transform:** same bbox + 5% pad mapped to the page minus margins and a
  header band — extracted as a pure function (`detailFit(bbox, pageSize): { scale, offset }`)
  shared conceptually with the canvas framing.
- **Header:** facility name + level rendered as a PNG strip (CJK-safe, same
  technique as `legendImage.ts`) — new `report/detailHeader.ts`.
- **Image:** `embedPng`, drawn with position/rotation mapped through the fit
  transform (center-rotation converted to pdf-lib's corner-based rotation).
- **Polygons:** `drawAreaOverlays` generalized with an optional point mapper
  (`(pt: Pt) => Pt`, default identity) so the same code draws original pages
  (identity) and detail pages (fit transform). Store code labels scale with the
  fit.
- No legend on detail pages — the header names the single facility.

## Edge cases

- Detail page with no image → still exported as a vector-only zoomed view.
- Facility polygons removed after enabling → entry pruned; never rendered stale.
- Unscaled pages: irrelevant; detail pages show no measurements.
- `storeLabelMode: 'off'` → no codes on detail pages (consistent with main pages).
- Empty clipboard paste / non-image file → toast, no change.

## Testing

- **Store tests (`state/store.spec.ts`):** `detailCandidates` ordering and
  membership; enable/disable; pruning on last-polygon removal; v2→v3 migration
  (missing `detailPages` → `[]`); transform set/update under undo batching;
  image downscale helper.
- **Report tests (`report/*.spec.ts`):** exported doc page count and order
  (originals → detail pages → table page); `detailFit` math (bbox → page
  transform, orientation choice); rotation mapping; header PNG smoke test.
- **PdfStage (`PdfStage.spec.ts` pattern):** detail-mode entry/exit; image
  hit-test priority over other interactions in detail mode.

## Implementation phasing

1. **Data model + store logic** — types, `detailPages`/`detailEditing`,
   actions, `detailCandidates`, pruning, migration, downscale helper, tests.
2. **Selection UI + detail mode** — InspectorPanel section, PdfStage detail
   rendering, auto-framing, paste/file input, move/scale/rotate interaction.
3. **Export** — `detailFit`, `detailHeader.ts`, point-mapped
   `drawAreaOverlays`, page insertion, tests.
