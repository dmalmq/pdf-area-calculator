# Detail-Page Navigation and Movable Summary — Design

**Date:** 2026-07-13
**Status:** Approved direction; pending written-spec review

## Problem

The inspector renders each detail-page candidate as one compressed horizontal row. Facility names are truncated, repeated for every floor, and visually compete with the floor and store count. Users cannot reliably identify candidates when the inspector is narrow.

Detail pages identify the facility and floor through a fixed export header, but the editor does not provide a movable information block on the page itself. The page also omits the current facility-and-floor area and store count.

## Goals

- Make detail-page candidates easy to scan without depending on truncated names or hover-only text.
- Group candidates by facility and list the facility's floors beneath it.
- Add one movable summary object to each enabled detail page.
- Show the full facility name, current floor, facility area on that floor, and store count on that floor.
- Use the saved summary position in both the detail editor and exported PDF.
- Replace the existing fixed export header with the movable summary so information is not duplicated.
- Meet the project's WCAG 2.2 AA baseline.

## Non-goals

- Separate independently movable facility, floor, area, or store-count fields.
- A table covering all floors or all facilities.
- User-editable metric values; metrics remain derived from project data.
- Font, color, or table-layout customization.
- Resizable or rotatable summary labels.
- A new sidebar-resize system.

## Product direction

The interface is for facility planning staff and should remain calm, precise, and dependable. Full names and explicit hierarchy take priority over maximum row density. The implementation should reuse existing controls, spacing tokens, state patterns, metric selectors, and CJK-safe report rendering.

## Sidebar design

The existing `Detail pages` disclosure remains in the Page inspector.

Candidates are grouped in the existing facility order. Each group contains:

1. The full facility name as a group heading. It may wrap; it must not ellipsize.
2. One floor row per candidate, in current page order.
3. A checkbox, floor label, store count, and—when enabled—an `Edit` button.

The facility name appears once per group rather than once per floor. Floor rows use a two-level hierarchy: the floor is the primary row label and the store count is secondary metadata. The checkbox label includes both values for assistive technology. The `Edit` button retains its existing behavior.

The disclosure summary may show the number of enabled detail pages as secondary text when at least one is enabled. This count is informational and does not replace checkbox state.

### Empty and narrow states

- No candidates: retain the current instructional empty state.
- Long facility names: wrap to multiple lines without horizontal scrolling.
- Long translated floor or store-count text: rows wrap rather than overlap controls.
- Keyboard order follows visual order: facility group, checkbox row, optional Edit button.
- Focus rings remain visible and are not clipped by the scroll container.

## Movable detail summary

Each enabled detail page has one combined summary object. It renders:

- Full facility name
- Current floor label
- A one-row table with columns:
  - Floor
  - Area
  - Stores

The row values describe only the current facility on the current source floor.

### Metrics

- Area uses the same facility-by-level net-area calculation used by the report summary, including the existing facility/hole semantics.
- The value is formatted consistently with the report as square metres.
- If the source floor is not calibrated, the area cell renders the localized equivalent of `Not calibrated`; it must not display point-squared data as though it were square metres.
- Stores use the same facility-by-level store count used by the existing report selector.
- Metrics are recomputed from current areas, calibration, and page data. They are not copied into `DetailPage`, preventing stale exported values.

### Position and defaults

`DetailPage` gains an optional summary position in source-page PDF-point coordinates:

```ts
summaryPosition?: Pt
```

The point represents the summary's top-left anchor in the same source-page coordinate system used by the detail image and facility polygons. This lets the detail editor and export pass the same anchor through their existing source-to-view/source-to-output mapping.

When `summaryPosition` is absent, derive a default near the top-left of the padded facility bounding box. The derived default remains non-persistent until the user drags it; opening an existing project must not create an undo entry.

Dragging the summary:

- Works only in detail-editing mode.
- Moves the summary as one object; its internal fields cannot be moved separately.
- Uses the existing `beginInteraction`/`endInteraction` undo batching pattern so one drag creates one undo step.
- Clamps the anchor so the summary remains within the padded detail bounds. The entire summary should remain reachable; if the summary is larger than an axis of the bounds, pin it to the leading edge on that axis.
- Takes hit-test priority over the underlying image so dragging the summary never moves the image.
- Uses a move cursor and a visible focused/active outline that is not color-only.
- Does not support resize or rotation.

Keyboard access is required: when focused, arrow keys move the summary by 1 source-page PDF point; Shift+Arrow moves it by 10 points. Each key press is undoable and must not interfere with existing Escape-to-close behavior.

## Rendering

### Detail editor

Render the summary above the image, polygons, and store tags. It remains readable over busy imagery through an opaque or near-opaque light surface, a full neutral border, and restrained shadow. Text and table rules must meet WCAG 2.2 AA contrast.

The editor summary uses semantic HTML for focus and keyboard operation. The visual dimensions should approximate the exported summary closely enough for placement, while the source-space anchor—not CSS pixel dimensions—is the persisted contract.

### PDF export

Replace the fixed header band with the movable summary. The export content area therefore no longer reserves a separate header band; facility geometry fits within the standard page margins.

Generate a CJK-safe PNG summary using the existing canvas-rendering approach in `report/detailHeader.ts` or a renamed/generalized replacement. The image includes the facility name, floor, area, and stores table. Draw it at the mapped `summaryPosition` above the detail image and vector overlays.

If no explicit position exists, use the same default-anchor function as the editor. The export must not mutate application state while deriving this default.

The summary should use a stable output size with a maximum width that preserves page margins. Long facility names wrap. The table columns remain legible and numeric values use tabular alignment.

## Data flow

1. `detailCandidates` continues to provide facility, page, floor, and store information for sidebar grouping.
2. The sidebar groups candidates by facility without changing enable/disable semantics.
3. Entering detail mode identifies the enabled `DetailPage` by facility and source page.
4. A shared selector derives current facility-by-level area and store metrics.
5. A shared pure helper derives the effective summary anchor from `summaryPosition` or the padded facility bounds.
6. Pointer or keyboard movement updates `summaryPosition` through a store action.
7. The editor maps the source-space anchor to the stage.
8. Export recomputes the same metrics, maps the same anchor through the detail fit, and draws the summary PNG.

## State and persistence

- Add `summaryPosition?: Pt` to `DetailPage`.
- Keep project-file version 3. `summaryPosition` is an optional field inside the existing optional `detailPages` data, so older version-3 files remain valid without migration.
- Existing projects and detail pages without `summaryPosition` use the derived default.
- Add `setDetailSummaryPosition(name, pageIndex, position)` following the existing detail-transform action pattern.
- Summary position participates in snapshot undo/redo and project serialization.
- Removing or pruning a detail page removes its summary position with the rest of the entry.

## Localization

Add translation keys for:

- Enabled detail-page count, if shown
- Summary table headers: floor, area, stores
- Uncalibrated area state
- Summary accessible label and movement hint

Reuse existing floor, area-unit, store-count, Edit, and detail-page strings where their grammar fits. Do not concatenate translated fragments when a complete localized string is needed.

## Error and edge cases

- Missing calibration: show `Not calibrated` and continue rendering/exporting.
- Zero stores: show `0`, not an empty cell.
- No facility polygon after data changes: existing detail-page pruning remains authoritative.
- Multiple facility polygons on one floor: aggregate through the existing facility-by-level report calculation.
- Long CJK/Latin facility names: wrap in both editor and export.
- Position from an older page geometry that falls outside current bounds: clamp at render time; persist the corrected position only after a user movement.
- Summary overlaps geometry: allowed by design because placement is user-controlled.
- Detail page without a background image: summary remains draggable and exports normally.

## Testing

### Sidebar component

- Candidates group by facility order and floors follow page order.
- Full facility names are rendered once per group.
- Enable/disable and Edit actions receive the same facility/page identifiers as before.
- Enabled count, if implemented, updates correctly.
- Accessible labels expose facility, floor, store count, and enabled state.

### Store and helpers

- Effective default position is deterministic and does not mutate state.
- Pointer and keyboard movement save source-page coordinates.
- Drag batching produces one undo step.
- Existing projects without `summaryPosition` import successfully.
- Serialization preserves an explicit position.
- Clamping handles normal bounds and a summary larger than the available axis.
- Metrics match the existing facility-by-level report result, including uncalibrated and zero-store cases.

### Detail editor

- Summary hit-testing wins over image dragging.
- Drag and keyboard movement update the same store action.
- Escape still closes detail mode when the summary is focused.
- Summary remains available when no background image exists.

### Report

- The old fixed detail header is not additionally rendered.
- Summary PNG contains the facility/floor/area/store content and supports CJK text.
- Explicit and default positions map correctly through detail fit.
- Uncalibrated output is labeled rather than reported as m².
- Long names wrap within page margins.
- Detail page order and total report page count remain unchanged.

## Acceptance criteria

- A user can read every facility name and scan its floors in the inspector without relying on tooltips.
- A user can enable a detail page and open its editor with unchanged semantics.
- Each detail page displays one combined summary for its facility and floor.
- The summary shows floor, facility area in m² or `Not calibrated`, and store count.
- The user can move the summary with pointer or keyboard, undo the move, save the project, reopen it, and retain the position.
- Export places the summary at the saved position and does not duplicate the old fixed header.
- Existing version-3 projects without a saved summary position continue to load and export.
- Focus, keyboard operation, non-color state cues, and text contrast satisfy WCAG 2.2 AA.
