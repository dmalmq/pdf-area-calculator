# Page Management & Master Tag Toggle — Design

**Status:** Approved
**Target:** `C:/Repositories/pdf-area-calculator`

Two independent features:

1. **Page management** — delete and reorder pages; changes flow through to the exported report.
2. **Master tag toggle** — hide/show all facility + store tags on the canvas via the `T` key and a toolbar button (on-screen only).

No new dependencies.

## Feature 1 — Delete & reorder pages

### Data model (approach A)

Today `activePageIndex` is simultaneously the `pages[]` array position, the original PDF page number, and the value stored in `area.pageIndex` — they are equal only because `pages` is built 1:1 in order. We decouple them:

- **`area.pageIndex` stays the stable original PDF page number** (0-based). Areas are never renumbered on delete/reorder.
- **`pages: PageState[]` becomes an ordered, possibly-trimmed list** of the pages the user keeps. Array order = display/report order. `PageState.pageIndex` remains the source page number (no new field).
- **`activePageIndex` becomes a pure cursor** into `pages[]`.
- Anything that needs the *source* page resolves it as `pages[activePageIndex].pageIndex`.

Because `pages` and `areas` are already part of `toProjectFile`, delete/reorder are captured by undo/redo and by save/load with no extra work.

### Store (`state/store.ts`)

- `deletePage(pageIndex: number): void` — no-op if `pages.length <= 1` (must keep ≥1 page). Removes the matching `PageState` and every area whose `pageIndex` equals it. Cursor rule: capture the viewed page's source index first; if the deleted page **was** the active one, clamp `activePageIndex` to the neighbor (`min(activePageIndex, newLength - 1)`); otherwise set `activePageIndex` to the surviving viewed page's new array position (so you keep looking at the same page even when an earlier page is removed). Ordinary `set` → one undo step, persisted.
- `movePage(from: number, to: number): void` — reorder within `pages[]` by array position (used for up/down: `to = from ± 1`; both clamped to valid range). Preserve the viewed page **by identity**: capture `pages[activePageIndex].pageIndex` before the move and set `activePageIndex` to that page's new array position afterward. One undo step, persisted.
- `orderedLevels(state)` — currently iterates `[...pages].sort((a,b) => a.pageIndex - b.pageIndex)`. Change to iterate `pages` in **array (display) order** so the report's per-level sections follow the user's arrangement. `levelOf` (which finds a page by `pageIndex`) is unchanged.

`AreaStore` interface gains `deletePage` and `movePage`.

### Rendering & navigation

Replace every use of `activePageIndex` that means *"the source PDF page"* with the resolved `pages[activePageIndex].pageIndex`. Introduce a local `const sourceIndex = page?.pageIndex` in `PdfStage` (where `page = pages[activePageIndex]` already exists) and thread it through:

- `PdfStage.tsx`: `pdfDoc.getPage(activePageIndex + 1)` → `getPage(sourceIndex + 1)`; `pageAreas` filter `area.pageIndex === activePageIndex` → `=== sourceIndex`; `addArea({ pageIndex: activePageIndex … })` → `pageIndex: sourceIndex` (store + facility draft); `facilitiesOnPage(state, activePageIndex)` → `(state, sourceIndex)` (legend draw, `legendBounds`, label-drag clamp); `mmPerPtFor(state, activePageIndex)` → `(state, sourceIndex)` (live area text, unscaled flag). Render effect deps: add `sourceIndex`/`page`.
- `Toolbar.tsx` prev/next call `setActivePage(activePageIndex ± 1)` and the page label reads `pages[activePageIndex].label` — both operate on array position, unchanged. `setActivePage` already clamps to `[0, pages.length-1]`.

### Page-list UI (`InspectorPanel.tsx`, Page tab)

A new **Pages** section at the top of the Page tab: a list of all kept pages, each row showing its position number and `label`, with the active page highlighted. Row interactions:

- Click a row → `setActivePage(index)` (jump to it).
- **↑ / ↓** buttons → `movePage(index, index-1)` / `movePage(index, index+1)`; disabled at the ends.
- **✕** button → `deletePage(pages[index].pageIndex)`; disabled when `pages.length === 1`.

No drag-and-drop in v1 (up/down only).

### Report export (`report/buildReport.ts`, `App.generateReport`)

The exported PDF must contain only the kept pages, in display order. `buildReport` gains a `pageOrder: number[]` argument = `state.pages.map(p => p.pageIndex)` (source indices in display order). Behavior:

- Build the output from the kept pages in `pageOrder` (copy/keep only those source pages, in that order), preserving the existing summary-table PNG page.
- Overlays/legends map each area to its page's **new** position: `newIndex = pageOrder.indexOf(area.pageIndex)` (skip if `-1`). Legend drawing iterates the new pages and resolves entries via the source index `pageOrder[newIndex]` (`entriesForPage` stays keyed by source index).
- Summary tables already aggregate over kept-page areas; with the `orderedLevels` change they follow the new order too.

`App.generateReport` passes `pageOrder` from `state.pages`.

## Feature 2 — Master tag toggle

- **State:** `AppState.tagsVisible: boolean` (default `true`), **excluded from `toProjectFile`** (view-only, like `tool`/`zoom`/`pan`) — never persisted, never undone. Add to `initialState`. Store action `setTagsVisible(visible: boolean)` (or `toggleTags()`); `AreaStore` interface updated.
- **Keybind:** `T` (currently unused) toggles it in `App.tsx`'s `onKeyDown`, subject to the existing "ignore while typing / modal open" guards.
- **Button:** a **Tags** toggle in the Toolbar with `aria-pressed={tagsVisible}`.
- **Canvas:** in `PdfStage.drawPolygon`, when `tagsVisible` is `false`, skip the tag box for **all** areas (facility name+m² and store code alike). When `true`, store tags still obey the existing Code/Number/Off (`storeLabelMode`) control. The legend (`legendVisible`) and live draft are unaffected. Add `tagsVisible` to the draw effect deps.
- **Export:** unaffected — store labels in the report still follow `storeLabelMode`.

## i18n keys (`i18n/messages.ts`, ja + en)

- `action.tags` — toolbar button label ("タグ" / "Tags").
- `pages.heading` — page-list section ("ページ" / "Pages").
- `pages.delete`, `pages.moveUp`, `pages.moveDown` — aria-labels/titles ("ページを削除"/"上へ"/"下へ" ; "Delete page"/"Move up"/"Move down").
- `shortcuts.tags` — help-row text ("すべてのタグ表示を切替" / "Toggle all tags"); add a `['T', 'shortcuts.tags']` row to `shortcutRows`.

## Edge cases

- Deleting the last remaining page is blocked (delete disabled at 1 page).
- Deleting the active page moves the cursor to the neighboring page.
- Moving the active page keeps it active (cursor follows it).
- Undo of a delete restores the page **and** its areas together (both in the snapshot); undo of a move restores order.
- Opening a saved project that has a trimmed/reordered page set: `loadDocument` first builds all pages, then `importProject` overrides with the saved `pages` — saved arrangement wins (already the flow).
- `tagsVisible` resets to `true` on app start (not persisted).

## Verification

- **Unit (`store.spec.ts`):** `deletePage` removes the page + its areas, clamps `activePageIndex`, and is a no-op at 1 page; `movePage` reorders and keeps the active page active; undo restores a deleted page+areas and a move; `toProjectFile` excludes `tagsVisible`; `setTagsVisible`/`toggleTags` flips state.
- **Report mapping:** a small unit check that `pageOrder.indexOf` maps areas to the correct new page index after a delete+reorder (pure helper), if extracted.
- **Gate:** `npm run typecheck`, `npx vitest run`, `npm run lint` (no new errors beyond the 12 pre-existing), `npm run build`.
- **Real-data:** against `SendaiStation-oversize_project.json` — delete a page (areas on it vanish; count drops), reorder two pages, generate the report, and confirm the output has the kept pages in the new order; confirm undo restores.
- **GUI smoke:** page list shows/reorders/deletes; `T` and the toolbar button hide/show all tags; no console errors.
