# Tab depth-cycling + editing inside the detail editor — Design

Approved 2026-07-14 (follow-up to the multi-select + snap spec).

## Background

Detail pages already render from the same `state.areas` objects as the floor page (on
screen and in the exported report), so geometry is inherently linked. What was missing
is interaction: the detail editor blocked all area selection/editing, and overlapping
areas on any page could only ever be selected topmost-first.

## Feature 1: Tab selects beneath overlapping areas (edit tool)

- With the cursor over a stack of overlapping areas in edit mode, **Tab** selects the
  topmost area when none of the stack is selected, otherwise the next area *beneath*
  the current primary selection, wrapping. **Shift+Tab** cycles upward.
- Tab is intercepted only when the cursor is over ≥1 area in edit mode; otherwise
  normal focus navigation is untouched.
- Pure helper `nextTabSelection(orderedTopFirst, currentId, backwards)` exported from
  `PdfStage.tsx` (existing test-helper pattern), unit-tested.
- Companion fix: body-drag no longer re-selects the topmost area at the click point
  when a *currently selected* area contains that point — the existing selection is
  dragged instead. Without this, Tab-selecting a beneath area would be undone by the
  very click that starts moving it.

## Feature 2: Edit + draw inside the detail editor

- The interaction target list becomes `interactiveAreas` = detail mode ? the detail
  facility's areas (same page, same name) : the page's areas. All hit-testing
  (body/tag/vertex/midpoint), marquee, Tab cycling, and snap extra-segments use it.
- **Edit tool** in detail mode: select, body/group drag, vertex drag, midpoint insert,
  tag drag, marquee, snapping — identical code path to the floor page. Edits are
  reflected everywhere automatically (single geometry).
- **Draw tool** in detail mode: draft clicks with snapping; closing the draft creates
  the area with `name = detailEditing.name` and `pageIndex = detailEditing.pageIndex`
  (stores get the facility's next code). The active facility selection in the sidebar
  is irrelevant inside a detail page.
- Precedence with the reference image (edit tool): area interactions win; image drag
  only when the click hits the image and no area; marquee only when neither. Middle
  button pan and summary-card drag unchanged. Pan tool unchanged.
- Escape ordering in detail mode: clears the draft (or selected vertex) first; only a
  further Escape closes the editor. Draft keys (Backspace/Enter/Escape) and vertex
  keys now work in detail mode; double-click closes a ≥3-point draft there too.
- Overlay rendering in detail mode gains selection highlight, vertex handles, draft
  preview, marquee, and snap markers (previously floor-page only).

## Testing

Unit: `nextTabSelection` ordering/wrapping/shift direction. E2E smoke: Tab cycling on
stacked areas, editing a store inside the detail editor and observing the same polygon
on the floor page, drawing a new store inside the detail editor.
