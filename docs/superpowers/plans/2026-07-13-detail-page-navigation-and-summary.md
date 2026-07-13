# Detail-Page Navigation and Movable Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make detail-page candidates readable by grouping floors under full facility names, and add a persisted movable facility/floor summary containing area and store count to the editor and exported PDF.

**Architecture:** Extend `DetailPage` with one optional source-page anchor and reuse the existing snapshot history and project serialization. Put deterministic summary metrics, defaulting, and clamping in `utils/detailSummary.ts`; both the React editor and PDF builder consume those pure helpers. Keep the existing CJK-safe canvas renderer in `report/detailHeader.ts`, but generalize its public API from a fixed header strip to a compact summary table.

**Tech Stack:** Electron, React 19, TypeScript 5.9, Zustand, pdf-lib, PDF.js viewport transforms, Vitest, CSS/OKLCH design tokens.

## Global Constraints

- Keep project-file version `3`; `summaryPosition` is optional and requires no migration.
- Add no dependency.
- One combined summary object only; no independent fields, resizing, rotation, or visual customization.
- Metrics describe only the current facility on the current floor and are always derived from current state.
- Uncalibrated area renders `Not calibrated`; never label point-squared data as m².
- Saved summary coordinates use source-page PDF points with a top-left anchor.
- Pointer drag is one undo step; arrow movement uses `1` point and Shift+Arrow uses `10` points.
- Summary hit-testing takes priority over detail-image dragging.
- Export replaces the old fixed header; it must not render duplicate facility/floor information.
- Long facility names wrap; no hover-only recovery for truncated content.
- Meet WCAG 2.2 AA for focus, keyboard operation, non-color state cues, and text contrast.
- Reuse the existing facility-by-level metric calculation, detail fit, translation system, control styles, and CJK canvas font.

---

## File Structure

**Create**

- `src/renderer/src/utils/detailSummary.ts` — pure summary metric lookup, padded bounds, default anchor, and clamping.
- `src/renderer/src/utils/detailSummary.spec.ts` — deterministic helper contracts and boundary cases.

**Modify**

- `src/renderer/src/state/types.ts` — optional `DetailPage.summaryPosition`.
- `src/renderer/src/state/store.ts` — `setDetailSummaryPosition` action and reuse of `reportByFacilityLevel` data.
- `src/renderer/src/state/store.spec.ts` — persistence and undo/redo coverage.
- `src/renderer/src/components/InspectorPanel.tsx` — group detail candidates by facility.
- `src/renderer/src/components/PdfStage.tsx` — semantic summary overlay, pointer/keyboard movement, and hit-test precedence.
- `src/renderer/src/components/detailView.ts` — pure summary pointer intent and viewport/source-coordinate helpers.
- `src/renderer/src/components/detailView.spec.ts` — interaction decision and coordinate tests.
- `src/renderer/src/report/detailHeader.ts` — render the wrapped facility/floor summary table PNG.
- `src/renderer/src/report/detailHeader.spec.ts` — content, wrapping, dimensions, and uncalibrated rendering.
- `src/renderer/src/report/buildReport.ts` — full-margin detail fit and positioned summary rendering.
- `src/renderer/src/report/buildReport.spec.ts` — no fixed header band, explicit/default placement, content, and order.
- `src/renderer/src/i18n/messages.ts` — enabled count, table headings, uncalibrated copy, and movement label/hint.
- `src/renderer/src/assets/main.css` — grouped list hierarchy and accessible summary overlay.

---

### Task 1: Persisted Summary Position and Pure Geometry

**Files:**
- Create: `src/renderer/src/utils/detailSummary.ts`
- Create: `src/renderer/src/utils/detailSummary.spec.ts`
- Modify: `src/renderer/src/state/types.ts:89-94`
- Modify: `src/renderer/src/state/store.ts` (`AreaStore` action declarations and detail actions near `setDetailTransform`)
- Test: `src/renderer/src/state/store.spec.ts`

**Interfaces:**
- Consumes: existing `Pt`, `BBox`, `FacilityLevelRow`, `reportByFacilityLevel`, Zustand snapshot history.
- Produces:
  - `DetailPage.summaryPosition?: Pt`
  - `DetailSummaryMetrics { name: string; level: string; areaM2: number | null; stores: number }`
  - `paddedDetailBounds(bbox: BBox): BBox`
  - `defaultDetailSummaryPosition(bbox: BBox): Pt`
  - `clampDetailSummaryPosition(position: Pt, bounds: BBox, size: { w: number; h: number }): Pt`
  - `detailSummaryMetrics(state, name, pageIndex): DetailSummaryMetrics | null`
  - `setDetailSummaryPosition(name: string, pageIndex: number, position: Pt): void`

- [ ] **Step 1: Write failing geometry and metric tests**

Create `src/renderer/src/utils/detailSummary.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  clampDetailSummaryPosition,
  defaultDetailSummaryPosition,
  detailSummaryMetrics,
  paddedDetailBounds
} from './detailSummary'

const bbox = { x: 100, y: 200, w: 400, h: 200 }

const pages = [
  { pageIndex: 7, label: 'B1F', scale: { kind: 'custom', mmPerPt: 1000 } },
  { pageIndex: 8, label: '2F', scale: null }
]

const square = (pageIndex: number, kind: 'facility' | 'store') => ({
  id: `${kind}-${pageIndex}`,
  pageIndex,
  kind,
  name: 'Central Mall',
  polygon: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ]
})

describe('detail summary geometry', () => {
  it('pads detail bounds by five percent per side', () => {
    expect(paddedDetailBounds(bbox)).toEqual({ x: 80, y: 190, w: 440, h: 220 })
  })

  it('defaults the top-left anchor to the padded bounds top-left', () => {
    expect(defaultDetailSummaryPosition(bbox)).toEqual({ x: 80, y: 410 })
  })

  it('keeps the entire summary inside the padded bounds', () => {
    const bounds = paddedDetailBounds(bbox)
    expect(clampDetailSummaryPosition({ x: 999, y: -999 }, bounds, { w: 120, h: 60 })).toEqual({
      x: 400,
      y: 250
    })
  })

  it('pins to the leading edge when the summary is larger than an axis', () => {
    const bounds = paddedDetailBounds(bbox)
    expect(clampDetailSummaryPosition({ x: 300, y: 300 }, bounds, { w: 900, h: 900 })).toEqual({
      x: 80,
      y: 410
    })
  })
})

describe('detailSummaryMetrics', () => {
  it('returns current facility-floor area and store count', () => {
    const state = {
      pages,
      areas: [square(7, 'facility'), square(7, 'store')]
    }
    expect(detailSummaryMetrics(state, 'Central Mall', 7)).toEqual({
      name: 'Central Mall',
      level: 'B1F',
      areaM2: 100,
      stores: 1
    })
  })

  it('returns null area for an uncalibrated floor', () => {
    const state = { pages, areas: [square(8, 'facility')] }
    expect(detailSummaryMetrics(state, 'Central Mall', 8)).toEqual({
      name: 'Central Mall',
      level: '2F',
      areaM2: null,
      stores: 0
    })
  })
})
```

The fixture uses the real `PageState` shape (`scale: ScaleMode | null`); with `mmPerPt: 1000` one point is one metre, so the 10×10 pt facility square is 100 m². The uncalibrated page (`scale: null`) must yield `areaM2: null`.

- [ ] **Step 2: Run the helper test and verify it fails**

Run:

```bash
npx vitest run src/renderer/src/utils/detailSummary.spec.ts
```

Expected: FAIL because `./detailSummary` does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `src/renderer/src/utils/detailSummary.ts`:

```ts
import type { BBox } from '../geometry/detailFit'
import { reportByFacilityLevel } from '../state/store'
import type { AppState, Pt } from '../state/types'

export interface DetailSummaryMetrics {
  name: string
  level: string
  areaM2: number | null
  stores: number
}

export function paddedDetailBounds(bbox: BBox): BBox {
  const padX = bbox.w * 0.05
  const padY = bbox.h * 0.05
  return {
    x: bbox.x - padX,
    y: bbox.y - padY,
    w: bbox.w + padX * 2,
    h: bbox.h + padY * 2
  }
}

export function defaultDetailSummaryPosition(bbox: BBox): Pt {
  const bounds = paddedDetailBounds(bbox)
  return { x: bounds.x, y: bounds.y + bounds.h }
}

export function clampDetailSummaryPosition(
  position: Pt,
  bounds: BBox,
  size: { w: number; h: number }
): Pt {
  const maxX = bounds.x + Math.max(0, bounds.w - size.w)
  const minY = bounds.y + Math.min(bounds.h, size.h)
  return {
    x: size.w >= bounds.w ? bounds.x : Math.min(Math.max(position.x, bounds.x), maxX),
    y:
      size.h >= bounds.h
        ? bounds.y + bounds.h
        : Math.min(Math.max(position.y, minY), bounds.y + bounds.h)
  }
}

export function detailSummaryMetrics(
  state: Pick<AppState, 'areas' | 'pages'>,
  name: string,
  pageIndex: number
): DetailSummaryMetrics | null {
  const level = state.pages.find((page) => page.pageIndex === pageIndex)?.label
  if (level == null) return null
  const row = reportByFacilityLevel(state).find(
    (candidate) => candidate.name === name && candidate.level === level
  )
  if (!row) return null
  return {
    name,
    level,
    areaM2: row.unscaledPt2 > 0 ? null : row.areaM2,
    stores: row.stores
  }
}
```

If `reportByFacilityLevel` requires additional state fields in its `ReportState` type, narrow `detailSummaryMetrics` to that existing type rather than duplicating the calculation.

- [ ] **Step 4: Run the helper test and correct fixture field names only**

Run:

```bash
npx vitest run src/renderer/src/utils/detailSummary.spec.ts
```

Expected: PASS. Do not change the production contracts to accommodate a bad fixture.

- [ ] **Step 5: Write failing store persistence and history tests**

Add to the existing `detail pages persistence` / transform-history sections of `src/renderer/src/state/store.spec.ts`:

```ts
it('stores, serializes, and restores a detail summary position', () => {
  const store = createAreaStore({ detailPages: [{ name: 'A', pageIndex: 0 }] })
  store.getState().setDetailSummaryPosition('A', 0, { x: 25, y: 80 })

  expect(store.getState().detailPages[0].summaryPosition).toEqual({ x: 25, y: 80 })
  expect(toProjectFile(store.getState()).detailPages?.[0].summaryPosition).toEqual({ x: 25, y: 80 })

  const reopened = createAreaStore()
  reopened.getState().importProject(toProjectFile(store.getState()))
  expect(reopened.getState().detailPages[0].summaryPosition).toEqual({ x: 25, y: 80 })
})

it('undoes one batched summary drag as one history entry', () => {
  const store = createAreaStore({ detailPages: [{ name: 'A', pageIndex: 0 }] })
  store.getState().beginInteraction()
  store.getState().setDetailSummaryPosition('A', 0, { x: 10, y: 20 })
  store.getState().setDetailSummaryPosition('A', 0, { x: 30, y: 40 })
  store.getState().endInteraction()

  expect(store.getState().undoStack).toHaveLength(1)
  store.getState().undo()
  expect(store.getState().detailPages[0].summaryPosition).toBeUndefined()
})

it('keeps version 3 projects without a summary position valid', () => {
  const store = createAreaStore()
  store.getState().importProject({
    version: 3,
    fileName: null,
    pages,
    names: ['A'],
    areas: [],
    detailPages: [{ name: 'A', pageIndex: 0 }]
  })
  expect(store.getState().detailPages[0].summaryPosition).toBeUndefined()
})
```

- [ ] **Step 6: Run the focused store tests and verify failure**

Run:

```bash
npx vitest run src/renderer/src/state/store.spec.ts
```

Expected: FAIL because `summaryPosition` and `setDetailSummaryPosition` are missing.

- [ ] **Step 7: Add the state field and action**

In `state/types.ts`, extend `DetailPage`:

```ts
export interface DetailPage {
  name: string
  pageIndex: number
  image?: string
  transform?: DetailTransform
  summaryPosition?: Pt
}
```

Add to the `AreaStore` action interface in `state/store.ts`:

```ts
setDetailSummaryPosition(name: string, pageIndex: number, position: Pt): void
```

Add beside `setDetailTransform`:

```ts
setDetailSummaryPosition(name, pageIndex, position) {
  set((state) => ({
    detailPages: state.detailPages.map((detailPage) =>
      detailPage.name === name && detailPage.pageIndex === pageIndex
        ? { ...detailPage, summaryPosition: position }
        : detailPage
    )
  }))
},
```

No serializer branch is needed because `toProjectFile` already includes `detailPages` verbatim.

- [ ] **Step 8: Run focused state/helper verification**

Run:

```bash
npx vitest run src/renderer/src/utils/detailSummary.spec.ts src/renderer/src/state/store.spec.ts
```

Expected: both files PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/renderer/src/utils/detailSummary.ts src/renderer/src/utils/detailSummary.spec.ts src/renderer/src/state/types.ts src/renderer/src/state/store.ts src/renderer/src/state/store.spec.ts
git commit -m "feat: persist detail summary position"
```

---

### Task 2: Grouped, Readable Detail-Page Sidebar

**Files:**
- Modify: `src/renderer/src/components/InspectorPanel.tsx:404-447`
- Modify: `src/renderer/src/assets/main.css:1010-1045`
- Modify: `src/renderer/src/i18n/messages.ts` (all locale objects containing `detail.*`)
- Test: `src/renderer/src/components/InspectorPanel.spec.ts` (new file; the repository has no component test for the inspector yet)

**Interfaces:**
- Consumes: `detailCandidates`, `detailPages`, `setDetailPageEnabled`, `openDetailEditor`.
- Produces: `groupDetailCandidates(candidates): Array<{ name: string; rows: DetailCandidate[] }>` and grouped semantic markup.

- [ ] **Step 1: Write the failing grouping test**

Export a pure helper from `InspectorPanel.tsx` and add this focused test to the nearest existing inspector/helper test file; if none exists, create `src/renderer/src/components/InspectorPanel.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { groupDetailCandidates } from './InspectorPanel'

describe('groupDetailCandidates', () => {
  it('preserves first-seen facility and floor order', () => {
    const candidates = [
      { name: 'JR East', pageIndex: 4, level: 'B1F', stores: 3 },
      { name: 'JR East', pageIndex: 2, level: '2F', stores: 8 },
      { name: 'Central Mall', pageIndex: 7, level: '1F', stores: 5 }
    ]
    expect(groupDetailCandidates(candidates)).toEqual([
      { name: 'JR East', rows: candidates.slice(0, 2) },
      { name: 'Central Mall', rows: candidates.slice(2) }
    ])
  })
})
```

- [ ] **Step 2: Run the sidebar test and verify failure**

Run:

```bash
npx vitest run src/renderer/src/components/InspectorPanel.spec.ts
```

Expected: FAIL because `groupDetailCandidates` is missing.

- [ ] **Step 3: Implement grouping and semantic markup**

Add near the top of `InspectorPanel.tsx`:

```ts
import type { DetailCandidate } from '../state/store'

export function groupDetailCandidates(
  candidates: DetailCandidate[]
): Array<{ name: string; rows: DetailCandidate[] }> {
  const groups = new Map<string, DetailCandidate[]>()
  for (const candidate of candidates) {
    const rows = groups.get(candidate.name)
    if (rows) rows.push(candidate)
    else groups.set(candidate.name, [candidate])
  }
  return [...groups].map(([name, rows]) => ({ name, rows }))
}
```

Inside the component derive:

```ts
const detailGroups = useMemo(() => groupDetailCandidates(candidates), [candidates])
const enabledDetailCount = detailPages.length
```

Replace the current flat `<ul>` with:

```tsx
<div className="detail-groups">
  {detailGroups.map((group) => (
    <section key={group.name} className="detail-group" aria-labelledby={`detail-${group.rows[0].pageIndex}`}>
      <h4 id={`detail-${group.rows[0].pageIndex}`} className="detail-group__name">
        {group.name}
      </h4>
      <ul className="detail-list">
        {group.rows.map((candidate) => {
          const enabled = detailPages.some(
            (detailPage) =>
              detailPage.name === candidate.name && detailPage.pageIndex === candidate.pageIndex
          )
          return (
            <li key={`${candidate.name}@${candidate.pageIndex}`} className="detail-row">
              <label className="detail-row__label">
                <input
                  type="checkbox"
                  checked={enabled}
                  aria-label={t('detail.toggleLabel', {
                    name: candidate.name,
                    level: candidate.level,
                    stores: candidate.stores
                  })}
                  onChange={(event) =>
                    setDetailPageEnabled(
                      candidate.name,
                      candidate.pageIndex,
                      event.target.checked
                    )
                  }
                />
                <span className="detail-row__text">
                  <strong>{candidate.level}</strong>
                  <small>{t('detail.stores', { n: candidate.stores })}</small>
                </span>
              </label>
              {enabled ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => openDetailEditor(candidate.name, candidate.pageIndex)}
                >
                  {t('detail.edit')}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  ))}
</div>
```

Render the disclosure summary as two spans only when count is nonzero:

```tsx
<summary>
  <span>{t('detail.heading')}</span>
  {enabledDetailCount > 0 ? (
    <span className="disclosure__meta">{t('detail.enabled', { n: enabledDetailCount })}</span>
  ) : null}
</summary>
```

Use a stable encoded/React-generated id if facility names or page indices can collide; never place the raw facility name in an HTML id.

- [ ] **Step 4: Add localized copy in every locale object**

Add equivalent keys beside existing `detail.*` entries:

```ts
'detail.enabled': '{n} enabled',
'detail.toggleLabel': '{name}, {level}, {stores} stores',
'detail.summaryLabel': '{name}, {level} detail summary. Use arrow keys to move; hold Shift for larger steps.',
'detail.summaryFloor': 'Floor',
'detail.summaryArea': 'Area',
'detail.summaryStores': 'Stores',
'detail.notCalibrated': 'Not calibrated',
```

Translate these strings in non-English locale blocks; do not copy English into a Japanese block.

- [ ] **Step 5: Replace compressed row CSS with grouped hierarchy**

Replace the current detail-list/row/name/meta rules in `main.css` with:

```css
.detail-groups,
.detail-list {
  display: flex;
  flex-direction: column;
}

.detail-groups {
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.detail-group + .detail-group {
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
}

.detail-group__name {
  margin-bottom: var(--space-1);
  color: var(--ink);
  font-size: 13px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.detail-list {
  gap: var(--space-1);
  list-style: none;
  padding: 0;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 40px;
  padding-left: var(--space-2);
  border-radius: var(--radius-control);
}

.detail-row:has(input:checked) {
  background: var(--accent-soft);
}

.detail-row__label {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  cursor: pointer;
}

.detail-row__text {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px var(--space-2);
  min-width: 0;
}

.detail-row__text small,
.disclosure__meta {
  color: var(--muted);
  font-size: 12px;
}

details.disclosure > summary {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
}
```

Keep native checkbox sizing and existing focus-visible rules. Do not add custom scrollbars or tooltips.

- [ ] **Step 6: Run focused sidebar and type checks**

Run:

```bash
npx vitest run src/renderer/src/components/InspectorPanel.spec.ts
npm run typecheck:web
```

Expected: test PASS and TypeScript exits `0`.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/renderer/src/components/InspectorPanel.tsx src/renderer/src/components/InspectorPanel.spec.ts src/renderer/src/assets/main.css src/renderer/src/i18n/messages.ts
git commit -m "feat: group detail pages by facility"
```

---

### Task 3: CJK-Safe Summary PNG and Positioned PDF Export

**Files:**
- Modify: `src/renderer/src/report/detailHeader.ts`
- Modify: `src/renderer/src/report/detailHeader.spec.ts`
- Modify: `src/renderer/src/report/buildReport.ts:150-258`
- Modify: `src/renderer/src/report/buildReport.spec.ts` detail-page suite

**Interfaces:**
- Consumes: `DetailSummaryMetrics`, `detailSummaryMetrics`, `defaultDetailSummaryPosition`, `clampDetailSummaryPosition`, existing `detailFit`, existing page labels/areas.
- Produces:
  - `renderDetailSummaryPng(input: DetailSummaryRenderInput): Promise<DetailSummaryPng>`
  - Detail export using full page margins and mapped source-space anchor.

- [ ] **Step 1: Replace the header-renderer tests with failing summary contracts**

In `detailHeader.spec.ts`, import `renderDetailSummaryPng` and update the canvas stub to record `fillText`. Add:

```ts
describe('renderDetailSummaryPng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('draws facility, floor, area, stores, and table headings', async () => {
    const { drawnText } = setupCanvas()
    const out = await renderDetailSummaryPng({
      name: 'エスパル仙台本館',
      level: 'B1F',
      area: '1,284.50 m²',
      stores: '33',
      labels: { floor: 'Floor', area: 'Area', stores: 'Stores' }
    })

    expect(out.png.length).toBeGreaterThan(0)
    expect(out.width).toBeGreaterThan(out.height)
    expect(drawnText).toEqual(
      expect.arrayContaining([
        'エスパル仙台本館',
        'B1F',
        '1,284.50 m²',
        '33',
        'Floor',
        'Area',
        'Stores'
      ])
    )
  })

  it('draws the explicit uncalibrated value', async () => {
    const { drawnText } = setupCanvas()
    await renderDetailSummaryPng({
      name: 'Central Mall',
      level: '2F',
      area: 'Not calibrated',
      stores: '0',
      labels: { floor: 'Floor', area: 'Area', stores: 'Stores' }
    })
    expect(drawnText).toContain('Not calibrated')
  })

  it('wraps a long facility name within the maximum width', async () => {
    setupCanvas()
    const out = await renderDetailSummaryPng({
      name: 'A very long facility name that cannot fit on one line without wrapping',
      level: '4F',
      area: '8,200.00 m²',
      stores: '91',
      labels: { floor: 'Floor', area: 'Area', stores: 'Stores' },
      maxWidth: 320
    })
    expect(out.width).toBeLessThanOrEqual(320)
    expect(out.height).toBeGreaterThan(60)
  })
})
```

- [ ] **Step 2: Run renderer tests and verify failure**

```bash
npx vitest run src/renderer/src/report/detailHeader.spec.ts
```

Expected: FAIL because `renderDetailSummaryPng` is missing.

- [ ] **Step 3: Generalize the canvas renderer**

Replace `renderDetailHeaderPng` with this public contract:

```ts
export interface DetailSummaryRenderInput {
  name: string
  level: string
  area: string
  stores: string
  labels: { floor: string; area: string; stores: string }
  maxWidth?: number
}

export interface DetailSummaryPng {
  png: Uint8Array
  width: number
  height: number
}

export async function renderDetailSummaryPng(
  input: DetailSummaryRenderInput
): Promise<DetailSummaryPng>
```

Implement it with the existing `REPORT_FONT_FAMILY`, DPR `2`, opaque `#ffffff` background, `#8f9b94` full border, `#26362f` primary text, and `#65756d` secondary text. Use deterministic constants:

```ts
const MAX_WIDTH = 360
const MIN_WIDTH = 280
const PAD_X = 12
const PAD_Y = 10
const NAME_SIZE = 15
const BODY_SIZE = 13
const LABEL_SIZE = 11
const LINE_HEIGHT = 19
const TABLE_GAP = 8
```

Wrap facility names by measured words for spaced scripts and by measured characters for unspaced CJK strings. Measure the three table columns, right-align area/stores values, and cap final width at `input.maxWidth ?? MAX_WIDTH`. Keep the existing Promise-based `canvas.toBlob` conversion exactly; do not add DOM-to-image dependencies.

- [ ] **Step 4: Run summary renderer tests**

```bash
npx vitest run src/renderer/src/report/detailHeader.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing PDF placement tests**

In `buildReport.spec.ts`, update the existing canvas stub for the new summary strings and add assertions around the created detail page. Spy on `PDFPage.prototype.drawImage` or inspect the generated page content using the existing test convention:

```ts
it('uses an explicit source-space summary position and does not reserve a fixed header band', async () => {
  const detail = {
    name: 'A',
    pageIndex: 0,
    summaryPosition: { x: 25, y: 90 }
  }
  const bytes = await buildReportPdf(
    sourceBytes,
    summaryPng,
    areas,
    {},
    undefined,
    { mode: 'code', prefixes: {} },
    [0],
    { pages: [detail], areas, pageLabels: ['1F'] }
  )
  const output = await PDFDocument.load(bytes)
  expect(output.getPageCount()).toBe(3)
  expect(summaryRenderer).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'A', level: '1F', stores: '0' })
  )
  expect(detailFitSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      width: expect.closeTo(detailPageWidth - 56),
      height: expect.closeTo(detailPageHeight - 56)
    })
  )
})

it('uses the deterministic default summary position without mutating DetailPage', async () => {
  const detail = { name: 'A', pageIndex: 0 }
  await buildReportPdf(
    sourceBytes,
    summaryPng,
    areas,
    {},
    undefined,
    { mode: 'code', prefixes: {} },
    [0],
    { pages: [detail], areas, pageLabels: ['1F'] }
  )
  expect(detail).toEqual({ name: 'A', pageIndex: 0 })
})

it('labels an uncalibrated detail summary instead of reporting pt² as m²', async () => {
  await buildUncalibratedDetailReport()
  expect(summaryRenderer).toHaveBeenCalledWith(
    expect.objectContaining({ area: 'Not calibrated' })
  )
})
```

Reuse the suite's existing fixtures (`wideFacility`, `onePixelPng`, `stubHeaderCanvas` — rename it `stubSummaryCanvas` when its recorded strings change); do not introduce a second PDF setup helper.

- [ ] **Step 6: Run PDF tests and verify failure**

```bash
npx vitest run src/renderer/src/report/buildReport.spec.ts
```

Expected: FAIL because the builder still calls the old fixed-header renderer and reserves `header.height + DETAIL_HEADER_GAP`.

- [ ] **Step 7: Replace fixed header export with positioned summary**

In `buildReport.ts`:

1. Import `renderDetailSummaryPng` and the pure helpers from `utils/detailSummary.ts`.
2. Delete `DETAIL_HEADER_GAP`.
3. Set the fit area to full margins:

```ts
const contentX = DETAIL_MARGIN
const contentY = DETAIL_MARGIN
const contentW = pageW - DETAIL_MARGIN * 2
const contentH = pageH - DETAIL_MARGIN * 2
const fit = detailFit(bbox, { width: contentW, height: contentH })
```

4. Derive metrics before drawing. Use the same `reportByFacilityLevel` calculation via `detailSummaryMetrics`; extend `DetailOptions` with the exact scale/page fields that helper needs rather than reimplementing area math.
5. Format area as:

```ts
const area = metrics.areaM2 == null ? t('detail.notCalibrated') : `${metrics.areaM2.toFixed(2)} m²`
```

Because report code runs outside React, use the existing non-hook `t()` from `../i18n` (the same live translator `App.tsx` and `PdfStage.tsx` already use imperatively) for the summary table labels and the uncalibrated string. Do not hard-code English in export output.
6. Render and embed the summary after image/polygons.
7. Map its source-space top-left anchor. Since pdf-lib draws from bottom-left:

```ts
const sourcePosition = dp.summaryPosition ?? defaultDetailSummaryPosition(bbox)
const summary = await renderDetailSummaryPng(renderInput)
const sourceSize = { w: summary.width / fit.scale, h: summary.height / fit.scale }
const clamped = clampDetailSummaryPosition(
  sourcePosition,
  paddedDetailBounds(bbox),
  sourceSize
)
const mappedTopLeft = mapPt(clamped)
page.drawImage(summaryImage, {
  x: mappedTopLeft.x,
  y: mappedTopLeft.y - summary.height,
  width: summary.width,
  height: summary.height
})
```

Keep summary size stable in output points; only its anchor is mapped through the detail fit.

- [ ] **Step 8: Run report verification**

```bash
npx vitest run src/renderer/src/report/detailHeader.spec.ts src/renderer/src/report/buildReport.spec.ts
```

Expected: both files PASS, including unchanged page-order/page-count tests.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/renderer/src/report/detailHeader.ts src/renderer/src/report/detailHeader.spec.ts src/renderer/src/report/buildReport.ts src/renderer/src/report/buildReport.spec.ts src/renderer/src/App.tsx
git commit -m "feat: export movable detail summary"
```

---

### Task 4: Editor Summary Overlay, Pointer Drag, and Keyboard Movement

**Files:**
- Modify: `src/renderer/src/components/detailView.ts`
- Modify: `src/renderer/src/components/detailView.spec.ts`
- Modify: `src/renderer/src/components/PdfStage.tsx`
- Modify: `src/renderer/src/components/PdfStage.spec.ts`
- Modify: `src/renderer/src/assets/main.css`

**Interfaces:**
- Consumes: Task 1 summary helpers/action and Task 3 metric presentation content.
- Produces:
  - `detailPointerIntent(..., summaryHit): 'detailSummary' | 'detailImage' | 'pan' | 'normal' | 'none'`
  - A focusable `.detail-summary` HTML overlay with pointer/keyboard movement.
  - A `DragState` branch for `detailSummary` using source-page points.

- [ ] **Step 1: Write failing hit-priority and keyboard-delta tests**

Update `detailView.spec.ts`:

```ts
import { detailKeyboardDelta, detailPointerIntent } from './detailView'

describe('detail summary interaction decisions', () => {
  it('lets the summary win over image dragging and Pan', () => {
    expect(detailPointerIntent(true, 0, 'pan', true, true)).toBe('detailSummary')
  })

  it('still uses image dragging outside the summary', () => {
    expect(detailPointerIntent(true, 0, 'pan', true, false)).toBe('detailImage')
  })

  it('maps arrows to source-space movement using approved increments', () => {
    expect(detailKeyboardDelta('ArrowLeft', false)).toEqual({ x: -1, y: 0 })
    expect(detailKeyboardDelta('ArrowUp', false)).toEqual({ x: 0, y: 1 })
    expect(detailKeyboardDelta('ArrowDown', true)).toEqual({ x: 0, y: -10 })
    expect(detailKeyboardDelta('Enter', false)).toBeNull()
  })
})
```

Update existing `detailPointerIntent` calls to pass `false` for `summaryHit`.

- [ ] **Step 2: Run interaction tests and verify failure**

```bash
npx vitest run src/renderer/src/components/detailView.spec.ts src/renderer/src/components/PdfStage.spec.ts
```

Expected: FAIL from the changed signature and missing `detailKeyboardDelta`.

- [ ] **Step 3: Implement pure interaction decisions**

In `detailView.ts`:

```ts
export function detailPointerIntent(
  detailEditing: boolean,
  button: number,
  tool: Tool,
  imageHit: boolean,
  summaryHit: boolean
): 'detailSummary' | 'detailImage' | 'pan' | 'normal' | 'none' {
  if (!detailEditing) return button === 1 || (button === 0 && tool === 'pan') ? 'pan' : 'normal'
  if (button === 1) return 'pan'
  if (button === 0 && summaryHit) return 'detailSummary'
  if (button === 0 && imageHit) return 'detailImage'
  if (button === 0 && tool === 'pan') return 'pan'
  return 'none'
}

export function detailKeyboardDelta(key: string, shift: boolean): Pt | null {
  const step = shift ? 10 : 1
  if (key === 'ArrowLeft') return { x: -step, y: 0 }
  if (key === 'ArrowRight') return { x: step, y: 0 }
  if (key === 'ArrowUp') return { x: 0, y: step }
  if (key === 'ArrowDown') return { x: 0, y: -step }
  return null
}
```

- [ ] **Step 4: Run pure interaction tests**

```bash
npx vitest run src/renderer/src/components/detailView.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Add the editor summary overlay**

In `PdfStage.tsx`:

1. Select `setDetailSummaryPosition` from the store.
2. Derive `summaryMetrics`, `bbox`, and `effectiveSummaryPosition` with `useMemo`.
3. Add `summaryRef = useRef<HTMLDivElement>(null)`.
4. Convert source anchor to viewport coordinates with the existing viewport transform. Account for the wrapper's `zoom` exactly once; verify against the canvas overlay rather than guessing.
5. Render the overlay as a sibling of the canvases inside `.pdf-stage`:

```tsx
{detailEditing && summaryMetrics && summaryViewportPosition ? (
  <div
    ref={summaryRef}
    className="detail-summary"
    role="group"
    tabIndex={0}
    aria-label={t('detail.summaryLabel', {
      name: summaryMetrics.name,
      level: summaryMetrics.level
    })}
    style={{
      left: summaryViewportPosition.x,
      top: summaryViewportPosition.y
    }}
    onPointerDown={onSummaryPointerDown}
    onKeyDown={onSummaryKeyDown}
  >
    <div className="detail-summary__heading">
      <strong>{summaryMetrics.name}</strong>
      <span>{summaryMetrics.level}</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>{t('detail.summaryFloor')}</th>
          <th>{t('detail.summaryArea')}</th>
          <th>{t('detail.summaryStores')}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{summaryMetrics.level}</td>
          <td>
            {summaryMetrics.areaM2 == null
              ? t('detail.notCalibrated')
              : `${summaryMetrics.areaM2.toFixed(2)} m²`}
          </td>
          <td>{summaryMetrics.stores}</td>
        </tr>
      </tbody>
    </table>
  </div>
) : null}
```

The overlay's visual order is above canvas and image; use z-index `2`, below the toolbar.

- [ ] **Step 6: Add pointer dragging with one undo batch**

Extend `DragState` with:

```ts
| {
    kind: 'detailSummary'
    pointerId: number
    startPt: Pt
    startPosition: Pt
  }
```

`onSummaryPointerDown` must stop propagation, accept only button `0`, flush wheel batching, focus the summary, capture the pointer, call `beginInteraction()`, and store the start source point/position.

On pointer move, convert the event to a source PDF point through the existing `eventToPdfPt`, derive the candidate anchor, convert the live summary DOM size from viewport pixels to source points using the viewport scale and current zoom, clamp with `clampDetailSummaryPosition`, then call:

```ts
setDetailSummaryPosition(detailEditing.name, detailEditing.pageIndex, clamped)
```

On pointer up/cancel, release capture, clear drag, and call `endInteraction()`. Ensure canvas pointer handlers cannot start an image drag from the same event.

- [ ] **Step 7: Add keyboard movement and preserve Escape**

`onSummaryKeyDown`:

```ts
const onSummaryKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
  if (!detailEditing || !bbox || !effectiveSummaryPosition) return
  if (event.key === 'Escape') return
  const delta = detailKeyboardDelta(event.key, event.shiftKey)
  if (!delta) return
  event.preventDefault()
  event.stopPropagation()
  const size = summarySizeInSourcePoints()
  const next = clampDetailSummaryPosition(
    {
      x: effectiveSummaryPosition.x + delta.x,
      y: effectiveSummaryPosition.y + delta.y
    },
    paddedDetailBounds(bbox),
    size
  )
  setDetailSummaryPosition(detailEditing.name, detailEditing.pageIndex, next)
}
```

Do not wrap separate key presses in `beginInteraction`/`endInteraction`; each key press is one normal Zustand snapshot update. The existing window Escape listener remains responsible for closing detail mode.

- [ ] **Step 8: Add accessible overlay styling**

Append to `main.css`:

```css
.detail-summary {
  position: absolute;
  z-index: 2;
  min-width: 280px;
  max-width: min(360px, calc(100% - var(--space-4) * 2));
  color: var(--ink);
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid color-mix(in oklch, var(--ink) 42%, var(--line));
  border-radius: var(--radius-control);
  box-shadow: 0 4px 14px oklch(0.3 0.02 165 / 0.16);
  cursor: move;
  user-select: none;
  touch-action: none;
}

.detail-summary:focus-visible,
.detail-summary.is-dragging {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.detail-summary__heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--line);
}

.detail-summary__heading strong {
  overflow-wrap: anywhere;
}

.detail-summary__heading span,
.detail-summary th {
  color: var(--muted);
}

.detail-summary table {
  width: 100%;
  border-collapse: collapse;
}

.detail-summary th,
.detail-summary td {
  padding: var(--space-1) var(--space-3);
  text-align: left;
  white-space: nowrap;
}

.detail-summary th {
  padding-bottom: 0;
  font-size: 11px;
  font-weight: 600;
}

.detail-summary td:nth-child(n + 2),
.detail-summary th:nth-child(n + 2) {
  text-align: right;
}

.detail-summary tbody td {
  padding-bottom: var(--space-2);
  font-weight: 600;
}
```

Use `.is-dragging` from actual drag state. Do not animate position; direct manipulation must track the pointer exactly.

- [ ] **Step 9: Add component-level observable tests**

Where the current test harness does not mount React components, extract only the coordinate decision needed for deterministic testing rather than adding a new test dependency. Add tests proving:

```ts
it('converts a summary drag delta to source-space without zoom drift', () => {
  expect(summaryPositionAfterDrag(
    { x: 20, y: 80 },
    { x: 100, y: 100 },
    { x: 125, y: 90 }
  )).toEqual({ x: 45, y: 70 })
})
```

Also preserve the existing image intent tests with `summaryHit: false`. The focused suite must fail if summary priority is removed or arrow y-direction is inverted.

- [ ] **Step 10: Run editor and state verification**

```bash
npx vitest run src/renderer/src/components/detailView.spec.ts src/renderer/src/components/PdfStage.spec.ts src/renderer/src/state/store.spec.ts
npm run typecheck:web
```

Expected: all tests PASS and TypeScript exits `0`.

- [ ] **Step 11: Commit Task 4**

```bash
git add src/renderer/src/components/detailView.ts src/renderer/src/components/detailView.spec.ts src/renderer/src/components/PdfStage.tsx src/renderer/src/components/PdfStage.spec.ts src/renderer/src/assets/main.css
git commit -m "feat: move detail summary in editor"
```

---

### Task 5: End-to-End Verification and Cleanup

**Files:**
- Modify only files that fail the checks below; no speculative refactor.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: one verified sidebar → editor → save/reopen → export workflow.

- [ ] **Step 1: Run all directly affected tests together**

```bash
npx vitest run src/renderer/src/utils/detailSummary.spec.ts src/renderer/src/state/store.spec.ts src/renderer/src/components/InspectorPanel.spec.ts src/renderer/src/components/detailView.spec.ts src/renderer/src/components/PdfStage.spec.ts src/renderer/src/report/detailHeader.spec.ts src/renderer/src/report/buildReport.spec.ts
```

Expected: all files PASS. Fix only failures caused by this feature, then rerun the same command.

- [ ] **Step 2: Run static verification**

```bash
npm run typecheck
npm run lint
```

Expected: both commands exit `0`. Apply the existing Prettier formatting only to touched files if lint reports formatting errors; do not reformat the repository.

- [ ] **Step 3: Run the application smoke scenario**

Run:

```bash
npm run dev
```

Verify this observable scenario in the Electron window:

1. Open a PDF project containing at least two facilities and multiple floors.
2. Expand `Detail pages`; confirm each full facility name appears once and wraps instead of truncating.
3. Confirm floors remain in project page order and checkbox/Edit behavior is unchanged.
4. Enable one calibrated and one uncalibrated detail page.
5. Open the calibrated detail page; confirm the summary shows the correct facility, floor, m², and store count.
6. Drag the summary over the background image; confirm the summary moves instead of the image.
7. Undo once; confirm the entire drag reverts.
8. Focus the summary and press ArrowRight, then Shift+ArrowUp; confirm 1-point and 10-point movement and visible focus.
9. Press Escape; confirm detail mode closes.
10. Save and reopen the project; confirm the summary position persists.
11. Open the uncalibrated detail page; confirm the area says `Not calibrated`.
12. Export the PDF; confirm the summary appears at the saved position, long names wrap, and the old fixed header is absent.
13. Confirm detail-page ordering and report summary-page ordering remain unchanged.

- [ ] **Step 4: Commit any verification-only corrections**

If Step 1–3 required code corrections:

```bash
git add src/renderer/src
git commit -m "fix: verify movable detail summary workflow"
```

If no corrections were required, do not create an empty commit.
