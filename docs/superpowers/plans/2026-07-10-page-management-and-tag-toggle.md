# Page Management & Master Tag Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users delete and reorder PDF pages (reflected in the exported report) and toggle all facility/store tags on the canvas with a key and a button.

**Architecture:** `area.pageIndex` stays a stable original-PDF page number; `pages: PageState[]` becomes an ordered, trimmable list and `activePageIndex` a pure cursor into it; anything needing the source page resolves `pages[activePageIndex].pageIndex`. Page delete/reorder are ordinary store mutations, so undo/redo and save/load cover them for free (both live in `toProjectFile`). The report is rebuilt with pdf-lib to contain only kept pages in display order. The tag toggle is a view-only `tagsVisible` boolean, excluded from `toProjectFile`.

**Tech Stack:** Electron + React 19 + TypeScript, Zustand (`zustand/vanilla` store), pdf.js (render), pdf-lib (export), Vitest, ESLint/Prettier.

## Global Constraints

- No new dependencies.
- Prettier style: 2-space indent, single quotes, **no semicolons**. Match surrounding code exactly.
- `area.pageIndex` is a stable original-PDF page index — NEVER renumber areas on delete/reorder.
- `tagsVisible` is view-only: add to `AppState`/`initialState` but NOT to `toProjectFile` (so it is never persisted or undone).
- At least one page must always remain (deleting the last page is a no-op / disabled).
- Lint must stay at the 12 pre-existing errors, 0 warnings — introduce no new lint problems.
- Run tests with `npx vitest run <file>` from `C:/Repositories/pdf-area-calculator`.
- Commit after each task.

---

### Task 1: Tag-visibility state + store action

**Files:**
- Modify: `src/renderer/src/state/types.ts` (`AppState`)
- Modify: `src/renderer/src/state/store.ts` (`AreaStore` interface, `initialState`, new action)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Produces: `AppState.tagsVisible: boolean`; `AreaStore.setTagsVisible(visible: boolean): void`.

- [ ] **Step 1: Write the failing test** — append to `store.spec.ts` (inside the top-level, after the existing `describe` blocks):

```ts
describe('tag visibility', () => {
  it('defaults on, toggles, and is excluded from the saved fingerprint', () => {
    const store = createAreaStore({ pages, names: ['A'], areas: [square(0, 'A')] })
    expect(store.getState().tagsVisible).toBe(true)
    const before = JSON.stringify(toProjectFile(store.getState()))
    store.getState().setTagsVisible(false)
    expect(store.getState().tagsVisible).toBe(false)
    // view-only: does not change the persisted project
    expect(JSON.stringify(toProjectFile(store.getState()))).toBe(before)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: FAIL — `tagsVisible` is `undefined` / `setTagsVisible is not a function`.

- [ ] **Step 3: Add the state field to `AppState`** in `types.ts`. Find the `AppState` interface and add after `redoStack: string[]`:

```ts
  tagsVisible: boolean
```

- [ ] **Step 4: Add to `initialState`** in `store.ts` (the `const initialState: AppState = { … }` block). Add after `pan: { x: 0, y: 0 },`:

```ts
  tagsVisible: true,
```

- [ ] **Step 5: Add the interface member** to `AreaStore` in `store.ts` (after `endInteraction(): void`):

```ts
  setTagsVisible(visible: boolean): void
```

- [ ] **Step 6: Add the action** in `store.ts`. Put it right after the `setPages(pages) { set({ pages }) },` action:

```ts
    setTagsVisible(visible) {
      set({ tagsVisible: visible })
    },
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/types.ts src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: add view-only tagsVisible state and setTagsVisible action"
```

---

### Task 2: Tag toggle UI — canvas gate, toolbar button, T key

**Files:**
- Modify: `src/renderer/src/components/PdfStage.tsx` (`drawPolygon` tag block + draw-effect deps + store hook)
- Modify: `src/renderer/src/components/Toolbar.tsx` (button + store hooks)
- Modify: `src/renderer/src/App.tsx` (keyboard handler + `shortcutRows`)
- Modify: `src/renderer/src/i18n/messages.ts` (ja + en)

**Interfaces:**
- Consumes: `tagsVisible`, `setTagsVisible` from the store (Task 1).

- [ ] **Step 1: Add i18n keys** in `messages.ts`. In BOTH the `ja` block and the `en` block, add next to the other `action.*` keys:

ja:
```ts
    'action.tags': 'タグ',
```
en:
```ts
    'action.tags': 'Tags',
```

And next to the other `shortcuts.*` keys, add a help-row description:

ja:
```ts
    'shortcuts.tags': 'すべてのタグ表示を切替',
```
en:
```ts
    'shortcuts.tags': 'Toggle all tags',
```

- [ ] **Step 2: Add the shortcut row** in `App.tsx`. In the `shortcutRows` array, add after the `['F / S', 'shortcuts.kind']` row:

```ts
  ['T', 'shortcuts.tags'],
```

- [ ] **Step 3: Gate tags on the canvas** in `PdfStage.tsx`. Add a store hook near the other `useAreaStore` selectors (e.g. after `const legendVisible = useAreaStore((s) => s.legendVisible)`):

```ts
  const tagsVisible = useAreaStore((s) => s.tagsVisible)
```

In `drawPolygon`, find the tag-box block that begins `if (rect) {` (immediately after `const rect = tagRect(area, ctx, viewport, state)`), and change its condition to:

```ts
      if (tagsVisible && rect) {
```

Add `tagsVisible` to the dependency array of the overlay-draw `useEffect` (the one whose deps list includes `pageAreas`, `selectedAreaId`, `storeLabelMode`, etc.).

- [ ] **Step 4: Add the toolbar button** in `Toolbar.tsx`. Add two store hooks near the existing ones (after `const setDrawKind = useAreaStore((s) => s.setDrawKind)`):

```ts
  const tagsVisible = useAreaStore((s) => s.tagsVisible)
  const setTagsVisible = useAreaStore((s) => s.setTagsVisible)
```

In the end group (`<div className="topbar__group topbar__group--end">`), add before the Help button:

```tsx
        <button
          type="button"
          className="btn"
          aria-pressed={tagsVisible}
          onClick={() => setTagsVisible(!tagsVisible)}
        >
          {t('action.tags')}
        </button>
```

- [ ] **Step 5: Add the T keybind** in `App.tsx` `onKeyDown`. In the `else if` chain of single-key handlers, add after the `state.setDrawKind('store')` line:

```ts
      else if (event.key === 'T' || event.key === 't') state.setTagsVisible(!state.tagsVisible)
```

- [ ] **Step 6: Verify typecheck + build**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/PdfStage.tsx src/renderer/src/components/Toolbar.tsx src/renderer/src/App.tsx src/renderer/src/i18n/messages.ts
git commit -m "feat: master tag toggle (T key + toolbar button) hides all canvas tags"
```

---

### Task 3: `deletePage` store action

**Files:**
- Modify: `src/renderer/src/state/store.ts` (`AreaStore` interface + action)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Produces: `AreaStore.deletePage(sourceIndex: number): void` — removes the `PageState` with `pageIndex === sourceIndex` and every area on it; keeps ≥1 page; keeps you on the page you were viewing (or its neighbor if you deleted it); clears selection if the selected area was removed.

- [ ] **Step 1: Write the failing test** — append to `store.spec.ts`:

```ts
describe('deletePage', () => {
  it('removes the page and its areas, keeps >=1, and is undoable', () => {
    const a = square(0, 'A')
    const b = square(1, 'B')
    const store = createAreaStore({ pages, names: ['A', 'B'], areas: [a, b], activePageIndex: 1 })

    store.getState().deletePage(1)
    expect(store.getState().pages.map((p) => p.pageIndex)).toEqual([0])
    expect(store.getState().areas).toEqual([a])
    expect(store.getState().activePageIndex).toBe(0)

    // cannot delete the final remaining page
    store.getState().deletePage(0)
    expect(store.getState().pages).toHaveLength(1)

    // undo restores page 1 and area b together
    store.getState().undo()
    expect(store.getState().pages.map((p) => p.pageIndex)).toEqual([0, 1])
    expect(store.getState().areas).toEqual([a, b])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: FAIL — `deletePage is not a function`.

- [ ] **Step 3: Add the interface member** in `store.ts` `AreaStore` (after `setPages(pages: PageState[]): void`):

```ts
  deletePage(sourceIndex: number): void
```

- [ ] **Step 4: Add the action** in `store.ts` (right after the `setPages` action):

```ts
    deletePage(sourceIndex) {
      const state = get()
      if (state.pages.length <= 1) return
      const pages = state.pages.filter((p) => p.pageIndex !== sourceIndex)
      if (pages.length === state.pages.length) return
      const activeSource = state.pages[state.activePageIndex]?.pageIndex
      const activePageIndex =
        activeSource === sourceIndex
          ? Math.min(state.activePageIndex, pages.length - 1)
          : Math.max(
              0,
              pages.findIndex((p) => p.pageIndex === activeSource)
            )
      const areas = state.areas.filter((area) => area.pageIndex !== sourceIndex)
      const selectedAreaId = areas.some((area) => area.id === state.selectedAreaId)
        ? state.selectedAreaId
        : null
      set({ pages, areas, activePageIndex, selectedAreaId })
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: deletePage store action (removes page + its areas, undoable)"
```

---

### Task 4: `movePage` store action

**Files:**
- Modify: `src/renderer/src/state/store.ts` (`AreaStore` interface + action)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Produces: `AreaStore.movePage(from: number, to: number): void` — reorders `pages[]` by array position and keeps the currently-viewed page active.

- [ ] **Step 1: Write the failing test** — append to `store.spec.ts`:

```ts
describe('movePage', () => {
  it('reorders pages, keeps the viewed page active, and is undoable', () => {
    const store = createAreaStore({ pages, names: [], areas: [], activePageIndex: 0 })

    store.getState().movePage(0, 1)
    expect(store.getState().pages.map((p) => p.pageIndex)).toEqual([1, 0])
    // still viewing source page 0, now at array position 1
    expect(store.getState().activePageIndex).toBe(1)

    store.getState().undo()
    expect(store.getState().pages.map((p) => p.pageIndex)).toEqual([0, 1])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: FAIL — `movePage is not a function`.

- [ ] **Step 3: Add the interface member** in `store.ts` `AreaStore` (after `deletePage(sourceIndex: number): void`):

```ts
  movePage(from: number, to: number): void
```

- [ ] **Step 4: Add the action** in `store.ts` (right after the `deletePage` action):

```ts
    movePage(from, to) {
      const state = get()
      const n = state.pages.length
      if (from < 0 || from >= n) return
      const dest = Math.min(Math.max(to, 0), n - 1)
      if (dest === from) return
      const activeSource = state.pages[state.activePageIndex]?.pageIndex
      const pages = state.pages.slice()
      const [moved] = pages.splice(from, 1)
      pages.splice(dest, 0, moved)
      const activePageIndex = Math.max(
        0,
        pages.findIndex((p) => p.pageIndex === activeSource)
      )
      set({ pages, activePageIndex })
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: movePage store action (reorders pages, keeps active page)"
```

---

### Task 5: Report level order follows display order

**Files:**
- Modify: `src/renderer/src/state/store.ts` (`orderedLevels`)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Consumes/affects: `reportByLevel`, `reportByFacility`, `reportByFacilityLevel` (all call `orderedLevels`).

- [ ] **Step 1: Write the failing test** — append to `store.spec.ts` (uses the exported `reportByLevel`, already imported at the top of the file):

```ts
describe('report ordering', () => {
  it('orders levels by page display order, not by source index', () => {
    const twoPages = [
      { pageIndex: 0, label: '1F', scale: null },
      { pageIndex: 1, label: '2F', scale: null }
    ]
    const a0 = square(0, 'A')
    const a1 = square(1, 'B')
    expect(reportByLevel({ pages: twoPages, areas: [a0, a1] }).map((r) => r.level)).toEqual([
      '1F',
      '2F'
    ])
    const reordered = [twoPages[1], twoPages[0]]
    expect(reportByLevel({ pages: reordered, areas: [a0, a1] }).map((r) => r.level)).toEqual([
      '2F',
      '1F'
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: FAIL — second assertion returns `['1F','2F']` (still sorted by `pageIndex`).

- [ ] **Step 3: Change `orderedLevels`** in `store.ts`. Replace the loop header that sorts by `pageIndex`:

```ts
  for (const page of [...state.pages].sort((a, b) => a.pageIndex - b.pageIndex)) {
```

with iteration in array (display) order:

```ts
  for (const page of state.pages) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: report level order follows page display order"
```

---

### Task 6: Resolve the source page in PdfStage

**Files:**
- Modify: `src/renderer/src/components/PdfStage.tsx`

**Interfaces:**
- Consumes: `pages`, `activePageIndex` from the store; the resolved source index `pages[activePageIndex].pageIndex`.

This decouples the cursor from the source page so reorder/delete render correctly. Behavior is unchanged while pages are in natural order.

- [ ] **Step 1: Add the resolved source index.** In `PdfStage.tsx`, just after the existing `const page = pages[activePageIndex]` line, add:

```ts
  const sourceIndex = page ? page.pageIndex : 0
```

- [ ] **Step 2: Use it for the page render.** Change `pdfDoc.getPage(activePageIndex + 1)` to:

```ts
      .getPage(sourceIndex + 1)
```

and in that render `useEffect`'s dependency array, replace `activePageIndex` with `sourceIndex`.

- [ ] **Step 3: Use it for the areas filter.** Change the `pageAreas` memo body `areas.filter((area) => area.pageIndex === activePageIndex)` to compare with `sourceIndex`, and change its deps `[activePageIndex, areas]` to `[sourceIndex, areas]`:

```ts
  const pageAreas = useMemo(
    () => areas.filter((area) => area.pageIndex === sourceIndex),
    [sourceIndex, areas]
  )
```

- [ ] **Step 4: Use it when creating areas.** In `closeDraft`, both `addArea({ … pageIndex: activePageIndex … })` calls (store branch and facility branch) become `pageIndex: sourceIndex`. In the `closeDraft` `useCallback` deps array, replace `activePageIndex` with `sourceIndex`.

- [ ] **Step 5: Use it for legend + measurement lookups.** Replace `activePageIndex` with `sourceIndex` in every remaining call that passes it as a source page:
  - `facilitiesOnPage(state, activePageIndex)` — three call sites (overlay legend draw, `legendBounds`, the label-drag legend measurement).
  - `mmPerPtFor(state, activePageIndex)` — the live-area text and the `unscaled` flag.

Leave untouched: the `page` label render (`page?.label`) and anything passed to `setActivePage` (those are array-cursor uses).

- [ ] **Step 6: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Verify existing tests still pass**

Run: `npx vitest run`
Expected: all pass (no behavior change in natural order).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/PdfStage.tsx
git commit -m "refactor: resolve source PDF page via pages[activePageIndex].pageIndex"
```

---

### Task 7: Page-list UI (delete + reorder) in the Inspector

**Files:**
- Modify: `src/renderer/src/components/InspectorPanel.tsx`
- Modify: `src/renderer/src/i18n/messages.ts` (ja + en)

**Interfaces:**
- Consumes: `pages`, `activePageIndex`, `setActivePage`, `deletePage`, `movePage` from the store.

- [ ] **Step 1: Add i18n keys** in `messages.ts`, in BOTH `ja` and `en`, next to the other `page.*` keys:

ja:
```ts
    'pages.heading': 'ページ',
    'pages.delete': 'ページを削除',
    'pages.moveUp': '上へ',
    'pages.moveDown': '下へ',
```
en:
```ts
    'pages.heading': 'Pages',
    'pages.delete': 'Delete page',
    'pages.moveUp': 'Move up',
    'pages.moveDown': 'Move down',
```

- [ ] **Step 2: Add store hooks** in `InspectorPanel.tsx` near the existing `useAreaStore` selectors (it already reads `activePageIndex`, `pages`, `setPages`). Add:

```ts
  const setActivePage = useAreaStore((s) => s.setActivePage)
  const deletePage = useAreaStore((s) => s.deletePage)
  const movePage = useAreaStore((s) => s.movePage)
```

- [ ] **Step 3: Render the Pages section.** In the Page tab, inside the non-empty branch (the `<>` that follows `{!page ? (…) : (`), add this as the FIRST block, before the `status` note paragraph:

```tsx
              <div className="pane-section">
                <div className="pane-section__head">
                  <h2>{t('pages.heading')}</h2>
                  <span className="count">{pages.length}</span>
                </div>
                <ul className="page-list">
                  {pages.map((p, index) => (
                    <li
                      key={p.pageIndex}
                      className={index === activePageIndex ? 'page-row is-active' : 'page-row'}
                    >
                      <button
                        type="button"
                        className="page-row__label"
                        onClick={() => setActivePage(index)}
                      >
                        <span className="page-row__num">{index + 1}</span>
                        <span className="page-row__name">{p.label}</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn--icon"
                        aria-label={t('pages.moveUp')}
                        title={t('pages.moveUp')}
                        disabled={index === 0}
                        onClick={() => movePage(index, index - 1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn--icon"
                        aria-label={t('pages.moveDown')}
                        title={t('pages.moveDown')}
                        disabled={index === pages.length - 1}
                        onClick={() => movePage(index, index + 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn--icon"
                        aria-label={t('pages.delete')}
                        title={t('pages.delete')}
                        disabled={pages.length <= 1}
                        onClick={() => deletePage(p.pageIndex)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
```

- [ ] **Step 4: Add styles** in `src/renderer/src/assets/main.css`. Append:

```css
.page-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.page-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.page-row__label {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-2);
  text-align: left;
  color: var(--ink);
  cursor: pointer;
  overflow: hidden;
}
.page-row.is-active .page-row__label {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.page-row__num {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.page-row__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

(If any `--space-1` / `--accent-soft` token is not defined in `:root`, substitute the nearest existing token seen elsewhere in `main.css`.)

- [ ] **Step 5: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/InspectorPanel.tsx src/renderer/src/i18n/messages.ts src/renderer/src/assets/main.css
git commit -m "feat: page list with jump, up/down reorder, and delete"
```

---

### Task 8: Rebuild the exported report from kept pages in order

**Files:**
- Modify: `src/renderer/src/report/buildReport.ts` (`drawAreaOverlays`, `drawLegends`, `buildReportPdf`)
- Modify: `src/renderer/src/App.tsx` (`generateReport` — pass `pageOrder`)
- Test: `src/renderer/src/report/buildReport.spec.ts`

**Interfaces:**
- Produces: `buildReportPdf(originalBytes, png, areas?, colors?, legend?, storeLabels?, pageOrder?: number[])` — `pageOrder` is source page indices in display order; omitted/empty ⇒ all pages in natural order.

- [ ] **Step 1: Write the failing test** — append to `buildReport.spec.ts`. Add the pdf-lib import at the top if not present (`import { PDFDocument } from 'pdf-lib'`) and this block:

```ts
describe('buildReportPdf page order', () => {
  const PNG_1x1 = new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
  )
  async function threePagePdf(): Promise<Uint8Array> {
    const d = await PDFDocument.create()
    d.addPage([200, 200])
    d.addPage([200, 200])
    d.addPage([200, 200])
    return d.save()
  }

  it('keeps only the pages in pageOrder, in that order, plus the summary page', async () => {
    const src = await threePagePdf()
    const out = await buildReportPdf(src, PNG_1x1, [], {}, undefined, { mode: 'code', prefixes: {} }, [
      2,
      0
    ])
    const doc = await PDFDocument.load(out)
    // two kept pages + one appended summary page
    expect(doc.getPageCount()).toBe(3)
  })

  it('defaults to all pages when pageOrder is omitted', async () => {
    const src = await threePagePdf()
    const out = await buildReportPdf(src, PNG_1x1)
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(4) // 3 original + summary
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/report/buildReport.spec.ts`
Expected: FAIL — the first test returns 4 (all original pages kept) instead of 3.

- [ ] **Step 3: Thread `pageOrder` into `drawAreaOverlays`.** Change its signature to add a final parameter `pageOrder: number[]`, and inside the loop replace the page lookup `const page = pages[area.pageIndex]` with a mapped lookup:

```ts
  for (const area of areas) {
    const newIndex = pageOrder.indexOf(area.pageIndex)
    if (newIndex < 0 || area.polygon.length < 3) continue
    const page = pages[newIndex]
    if (!page) continue
    // …rest unchanged (color, holePaths, overlayPath, drawSvgPath, store label)…
  }
```

- [ ] **Step 4: Thread `pageOrder` into `drawLegends`.** Add a final parameter `pageOrder: number[]`, and change the entries lookup so it uses the source index of the new page:

```ts
    const entries = legend.entriesForPage(pageOrder[i])
```

- [ ] **Step 5: Rebuild the document in `buildReportPdf`.** Add `pageOrder: number[] = []` as the final parameter. Replace the top of the body (`const doc = await PDFDocument.load(originalBytes)`) with a copy-only-kept-pages build, and pass `order` down:

```ts
  const src = await PDFDocument.load(originalBytes)
  const order = pageOrder.length ? pageOrder : src.getPageIndices()
  const doc = await PDFDocument.create()
  const copied = await doc.copyPages(src, order)
  copied.forEach((p) => doc.addPage(p))
  const codeFont = await doc.embedFont(StandardFonts.Helvetica)
  drawAreaOverlays(doc, areas, colors, codeFont, storeLabels, order)
  if (legend) await drawLegends(doc, legend, order)
```

Leave the summary-page append (everything from `const img = await doc.embedPng(png)` onward) unchanged — it adds to the new `doc`.

- [ ] **Step 6: Pass `pageOrder` from the app** in `App.tsx` `generateReport`. Add a 7th argument to the `buildReportPdf(…)` call, after the `{ mode: state.storeLabelMode, prefixes: state.prefixes }` argument:

```ts
        state.pages.map((p) => p.pageIndex)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/report/buildReport.spec.ts`
Expected: PASS (both new tests and any pre-existing ones).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/report/buildReport.ts src/renderer/src/App.tsx src/renderer/src/report/buildReport.spec.ts
git commit -m "feat: export report with only kept pages in display order"
```

---

### Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors (node + web).

- [ ] **Step 2: Format, then unit tests**

Run: `npm run format && npx vitest run`
Expected: all test files pass, including the new page/tag/report tests.

- [ ] **Step 3: Lint**

Run: `npx eslint .`
Expected: `12 problems (12 errors, 0 warnings)` — the pre-existing baseline, no new problems. If a new problem appears, fix it (commonly a missing hook dependency — add it to the relevant deps array).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: builds `out/main`, `out/preload`, `out/renderer` with no errors.

- [ ] **Step 5: Real-data check (throwaway spec).** Create `src/renderer/src/state/__realpages.spec.ts`:

```ts
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createAreaStore } from './store'
import type { ProjectFile } from './types'

const PROJECT_PATH =
  'Q:/BIM/past/受け渡しフォルダ/Daniel/Revit 2024/Sendai Station/Exports/SendaiStation-oversize_project.json'

describe('real-data page management', () => {
  const project = JSON.parse(readFileSync(PROJECT_PATH, 'utf8')) as ProjectFile

  it('deletes a page (its areas vanish) and reorders, undoably', () => {
    const store = createAreaStore()
    store.getState().importProject(project)
    const pageCount = store.getState().pages.length
    const victim = store.getState().pages[store.getState().pages.length - 1].pageIndex
    const areasOnVictim = store.getState().areas.filter((a) => a.pageIndex === victim).length

    store.getState().deletePage(victim)
    expect(store.getState().pages).toHaveLength(pageCount - 1)
    expect(store.getState().areas.some((a) => a.pageIndex === victim)).toBe(false)

    store.getState().undo()
    expect(store.getState().pages).toHaveLength(pageCount)
    expect(store.getState().areas.filter((a) => a.pageIndex === victim)).toHaveLength(areasOnVictim)

    if (store.getState().pages.length >= 2) {
      const firstSource = store.getState().pages[0].pageIndex
      store.getState().movePage(0, 1)
      expect(store.getState().pages[1].pageIndex).toBe(firstSource)
    }
  })
})
```

Run: `npx vitest run src/renderer/src/state/__realpages.spec.ts`
Expected: PASS. Then delete the file: `rm src/renderer/src/state/__realpages.spec.ts` (do NOT commit it).

- [ ] **Step 6: GUI smoke.** Launch the built app (Electron pointed at the project). Confirm: the Toolbar **Tags** button and the `T` key hide/show all facility + store tags on the canvas; the Inspector Page tab shows the page list; up/down reorder and ✕ delete work; deleting a page removes its drawn areas and `Ctrl+Z` restores them; no console errors.

- [ ] **Step 7: Commit any verification fixups** (if Step 2/3 reformatted files or you fixed a lint issue):

```bash
git add -A
git commit -m "chore: verification fixups for page management and tag toggle"
```

---

## Self-Review

- **Spec coverage:** page delete (Task 3) ✓, reorder (Task 4) ✓, report reflects both (Tasks 5 + 8) ✓, source-page decoupling (Task 6) ✓, page-list UI (Task 7) ✓, tag toggle state/key/button/canvas (Tasks 1–2) ✓, export unaffected by tag toggle (tag gate is canvas-only in Task 2) ✓, i18n (Tasks 2 + 7) ✓, undo/persist (free via store; asserted in Tasks 3–4) ✓, edge cases — last-page guard (Task 3), active-page follow (Tasks 3–4) ✓, verification incl. real-data + GUI (Task 9) ✓.
- **Placeholder scan:** none — every code/test step is concrete.
- **Type consistency:** `deletePage(sourceIndex: number)`, `movePage(from: number, to: number)`, `setTagsVisible(visible: boolean)`, `buildReportPdf(…, pageOrder?: number[])`, `AppState.tagsVisible: boolean` — used consistently across tasks. `pageOrder` = source indices in display order everywhere.

## Addendum: pre-existing overlay fix (commit 655110f)

Task 8 MUST preserve the on-page overlay fix already on main (commit 655110f): `svgPath(points, pageHeight)` flips Y with `pageHeight - pt.y`, and `drawAreaOverlays` computes `const { height } = page.getSize()`, calls `svgPath(..., height)` for outer + holes, and passes `{ x: 0, y: height, ... }` to `page.drawSvgPath`. When rewriting `drawAreaOverlays` to add `pageOrder`, change ONLY the page lookup to `const newIndex = pageOrder.indexOf(area.pageIndex); if (newIndex < 0 || area.polygon.length < 3) continue; const page = pages[newIndex]; if (!page) continue` and keep the height / svgPath(..., height) / `{ x: 0, y: height }` bits intact. In the Step-1 test, reuse the existing `onePixelPng` constant already in buildReport.spec.ts (do NOT add a new PNG constant or duplicate `PDFDocument` import).
