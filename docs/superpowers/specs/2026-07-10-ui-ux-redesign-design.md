# PDF Area Calculator UI/UX Redesign

**Status:** Approved through section-by-section review
**Target:** `C:/Repositories/pdf-area-calculator`
**Register:** Product UI

## Product intent

The app is a desktop Electron tool for mixed professional users who open vector floor-plan PDFs, register facilities, set page scale, draw facility and store polygons, edit tags and legends, reuse geometry across floors, and export an annotated report. The redesign preserves that workflow and all persisted project/report behavior while replacing the current flat, crowded chrome with a polished, approachable, Japanese-first workspace.

The interface should feel calm, trustworthy, and guided without becoming a wizard. Frequent users retain direct modes and keyboard shortcuts; occasional users see the current task, prerequisite, and next action where they work.

## Approved direction

- **Layout:** Refined Three-Pane evolution, preserving desktop muscle memory.
- **Visual language:** Mineral + Pine. Stone/mineral neutrals, sumi-like dark ink, one muted pine action color, and facility colors only where they carry facility identity.
- **Avoid:** cobalt/purple SaaS color, gradients, glows, decorative glass, nested cards, marketing typography, animation for spectacle, icon-library churn, and always-visible secondary controls.
- **Accessibility:** WCAG AA, complete keyboard/focus behavior, reduced motion, and non-color state cues.
- **Language:** Japanese default with a user-facing English switcher. A minimal in-house i18n layer (two dictionaries + `t()`, no third-party framework, no new dependency) localizes every visible app string; the choice persists across launches via `localStorage`. Units, file extensions, and user data (facility names, store codes) are never translated. The exported PDF report keeps its Japanese generated headings in this pass (localizing the report is a stated follow-up).
- **Recovery scope:** dirty-work protection, delete confirmation, and one bounded deleted-area undo. No autosave or multi-step history.

## Workspace architecture

### Top bar, 50px

Keep only global and frequent controls:

1. Product mark plus current PDF/project title.
2. Visible dirty status: `保存済み` or `未保存の変更`.
3. One native File menu containing `PDFを開く`, `プロジェクトを開く`, and `プロジェクトを保存`.
4. Compact previous/next page controls plus the current level/page count.
5. Segmented tools: `描画`, `編集`, `移動`.
6. Segmented draw kind `施設`, `店舗`, visible only while `描画` is active.
7. Primary action `レポート作成`.
8. Help button opening the shortcuts/gestures dialog.
9. Language switcher segmented control `日本語`/`English` (persisted; default `日本語`).
10. At widths below 1180px, an `インスペクタ` button opens the right pane as a drawer.

Global modes use `aria-pressed`; hover never shares the selected appearance. Use text and simple typographic glyphs with accessible names. Do not add an icon dependency.

### Left pane, 250px

Use one pane with three tabs instead of four stacked bordered panels:

- **`施設`**: add a facility, choose the active facility, edit color and store-code prefix, and show a persistent active-facility footer. Selecting an existing facility is session state and does not mark the document dirty. Adding a facility or changing its metadata does.
- **`エリア`**: list current-page facility/store areas as quiet divided rows; select or enter Edit mode from a row; keep `すべてコピー` and `貼り付け`; remove row-level Delete to reduce accidental destruction. Deletion lives in the selection inspector and keyboard path.
- **`集計`**: three compact subviews `レベル`, `施設`, `施設×レベル`, backed by `reportByLevel`, `reportByFacility`, and `reportByFacilityLevel`. Render stacked summary rows that fit 250px instead of a wide table. Store counts and unscaled warnings appear here, so the in-app preview matches export semantics.

### Canvas center

Keep `PdfStage` and its existing PDF/canvas/pointer interaction model intact. Recompose only its surrounding/status UI:

- Top guidance pill/banner changes by mode: draw vertex instructions, edit gestures, pan hint, or calibration progress/cancel.
- Bottom status shows active tool, Facility/Store kind, active facility, vertex count when drawing, current scale or `縮尺未設定`, and dirty status.
- Bottom-right compact controls contain Zoom Out, percentage, Zoom In, and Fit.
- Empty state contains `PDFを開く`, a short description, and a non-blocking sequence: facility, scale, draw, report.
- PDF loading uses a reserved page-shaped skeleton and `PDFを読み込んでいます` status. Report generation does not blank the canvas.
- Continue honoring the existing hit-test priority, Edit-only label drag/reset, area/vertex editing, legend drag, calibration clicks, zoom anchoring, and pan behavior.

### Right inspector, 270px

Replace `ScalePanel` with `InspectorPanel` and two tabs:

- **`ページ`**: level label, current scale status, ratio scale, calibration line, custom factor, Apply to All, legend visibility/orientation/scale, and store-label mode. Ratio is expanded by default; calibration/custom/display groups use progressive disclosure. Nothing is ever hidden without another route to it.
- **`選択`**: enabled only when an area is selected and selected automatically on a new selection. Shows kind, facility, store code when relevant, measured area/vertex count, label reset, Copy, and destructive Delete. Users may manually return to Page while selection stays active; clearing selection returns to Page.

At 960-1179px the inspector becomes a fixed right drawer with scrim, close action, Escape handling, focus entry/return, and hidden content removed from pointer/keyboard access. At 1180px and above it is docked. Set the Electron minimum window to 960×680; do not maintain a stacked mobile layout for this desktop product.

## Workflow and feedback

### Primary sequence

1. Open PDF/project.
2. Add or activate a facility.
3. Set scale in Page inspector. Drawing is allowed before scale, but a persistent `縮尺未設定` warning explains that results remain in `pt²`.
4. Draw/edit facility and store polygons using existing tool and shortcut semantics.
5. Review Level/Facility/Facility×Level summaries.
6. Generate and save the report.

This sequence is guidance, not a gate. Experts may jump directly to any available action.

### Busy states

Use `type BusyAction = 'open-pdf' | 'open-project' | 'save-project' | 'generate-report' | null` in `App.tsx`.

- File actions disable only while the corresponding I/O operation runs.
- Report button becomes `作成中...` and remains disabled until success/failure.
- Open PDF/project displays the canvas skeleton/status.
- Failures use an alert-tone toast and leave the previous document intact whenever replacement has not completed.
- Success/error text enters the existing live region with `role="status"` or `role="alert"` as appropriate.

### Copy/paste feedback

All toolbar, sidebar, and keyboard paths call the same App-owned wrappers around the existing count-returning store actions. Exact messages:

- `1件をコピーしました` / `{n}件をコピーしました`
- `コピーするエリアがありません`
- `1件を貼り付けました` / `{n}件を貼り付けました`
- `貼り付けるエリアがありません`

### Dirty-work protection

Do not sprinkle an `isDirty` flag across every mutation — one missed action silently loses work. Derive dirtiness from the persisted payload instead:

- Extract the inline object currently built in `App.saveProject` into a pure `toProjectFile(state): ProjectFile` in `store.ts`, and use it in both `saveProject` and the dirty check (single source of truth).
- Add session-only `savedFingerprint: string | null` to `AppState` (never written into `ProjectFile`) and action `markProjectSaved(): void` that sets `savedFingerprint = JSON.stringify(toProjectFile(get()))`.
- `loadDocument` and `importProject` call the same fingerprint capture at the end of their `set` (via a follow-up `set` reading `get()`), so a freshly opened PDF or freshly imported project starts clean.
- App computes dirtiness with a `selectIsDirty(state)` selector: `state.savedFingerprint !== null && JSON.stringify(toProjectFile(state)) !== state.savedFingerprint`. Session-only state (tool, zoom, pan, selection, drawKind, calibration, clipboard, tabs, drawer, toast, dialog) is absent from `toProjectFile`, so it can never mark the document dirty — no per-action bookkeeping.
- `ponytail:` the selector re-serializes the persisted slice on store change; floor-plan projects are small so this is fine. If pan/drag re-renders ever show jank, memoize on the persisted slices or switch to a per-action dirty flag.

Before Open PDF/Open Project replaces dirty work (`selectIsDirty` true), show one native dialog:

- Title: `未保存の変更があります`
- Body: `新しいファイルを開く前に、現在のプロジェクトを保存しますか？`
- Actions: `保存して続行`, `保存せず続行`, `キャンセル`.
- Save and Continue proceeds only when the save dialog returns a path; canceling or a failed/canceled save leaves the current document and the pending open untouched. Discard proceeds. Cancel aborts.
- A successful `saveProject` calls `markProjectSaved()`.

### Deletion and one-step undo

Change the store contract to:

```ts
export interface DeletedAreaSnapshot {
  area: Area
  index: number
}

deleteArea(id: string): DeletedAreaSnapshot | null
restoreDeletedArea(snapshot: DeletedAreaSnapshot): void
```

Every UI/keyboard delete path first opens a native confirmation dialog naming the area/code and measured value when available. On confirmation, delete it, retain the returned snapshot in App state for eight seconds, and show `エリアを削除しました` with action `元に戻す`. The action and `Ctrl/Cmd+Z` restore that snapshot at its original array index and reselect it. A later deletion replaces the previous snapshot; expiration clears it. No other edit history is introduced.

## Visual system

### Exact colors

Define semantic OKLCH variables in `main.css`:

```css
--workspace: oklch(0.952 0.0051 145.5);
--panel: oklch(0.976 0.0051 145.5);
--surface: oklch(0.9887 0.0045 134.8);
--ink: oklch(0.3051 0.0174 165.9);
--muted: oklch(0.5485 0.0199 164.2);
--line: oklch(0.89 0.0109 158.8);
--accent: oklch(0.5087 0.0667 166.2);
--accent-hover: oklch(0.4438 0.0586 165.9);
--accent-soft: oklch(0.9341 0.0126 164.8);
--accent-soft-ink: oklch(0.426 0.0588 165.6);
--canvas: oklch(0.9071 0.0084 157.1);
--danger: oklch(0.5261 0.1589 31.3);
--danger-soft: oklch(0.973 0.0132 28.9);
--warning-ink: oklch(0.4711 0.091 76);
--warning-soft: oklch(0.98 0.0235 88.2);
```

Observed contrast for the selected sRGB equivalents: ink/panel 12.42:1, muted/panel 4.52:1, white/accent 5.58:1, accent-soft-ink/accent-soft 6.62:1, and danger/danger-soft 5.34:1. Recheck in the implemented CSS after browser color conversion.

Facility polygon/swatch colors remain data colors and are not replaced with the pine UI accent. Use the pine accent only for primary actions, focus/selection, and active modes.

### Typography and geometry

- Font stack: `'Yu Gothic UI Variable', 'Yu Gothic UI', 'Noto Sans JP', Meiryo, system-ui, sans-serif`.
- Fixed type scale: 12px metadata, 13px body/control, 14px panel heading, 16px dialog/section heading, 20px empty-state title.
- Weights: 400 body, 600 controls/labels, 700 selected/heading. Use tabular figures for measurements, page counts, percentages, and codes.
- Spacing: 4, 8, 12, 16, 24px only; 32px only for the canvas document gutter.
- Radii: 7px controls, 10px panes/panels, 14px dialogs/toasts. Pills are reserved for switches/status chips with a real compact state.
- Panels use surface contrast or one hairline, not border + shadow + nested card. Reserve shadow for the PDF sheet, drawer, dialog, and toast.
- Named layers: base 0, sticky 10, drawer/backdrop 20/21, dialog/backdrop 30/31, toast 40, tooltip 50.
- State transitions: 150-200ms ease-out on color, opacity, and transform only. Reduced-motion collapses them to effectively instant. No entry choreography.

### Control behavior

- Buttons have explicit roles: primary, neutral, ghost, danger, icon-only. `レポート作成` is the only standing primary button.
- Segmented controls have one selected segment with filled surface and non-color indicators; hover is subtle and never identical to selected.
- Every button/control implements default, hover, focus-visible, active, disabled, and loading where applicable.
- Repeated area/facility rows use spacing and a single divider; only selected rows receive `accent-soft` fill.
- Inputs retain labels above fields. Placeholder text is not a label.
- Toasts are actionable when undo is available and otherwise non-modal.
- Use native `<dialog>` for shortcuts, dirty-work confirmation, and delete confirmation; manage `showModal`, close, focus return, and Escape through one reusable wrapper.

## Component boundaries

- `App.tsx`: file/report orchestration, `BusyAction`, dirty replacement intent, delete confirmation, one deleted-area timer/snapshot, actionable toast, shortcuts dialog, and inspector drawer state. Preserve global shortcut routing but send delete/copy/paste through App wrappers.
- `components/Toolbar.tsx`: top-bar presentation only; existing store modes plus callbacks for I/O/dialog/drawer actions. No report or persistence logic.
- `components/Sidebar.tsx`: own `facilities | areas | report` local tab and render the three left-pane views; use existing store selectors/actions; receive App wrappers for copy/paste.
- Rename `components/ScalePanel.tsx` to `components/InspectorPanel.tsx` and `ScalePanel` to `InspectorPanel`; `App.tsx` is the only import/callsite. Keep calibration draft props and add copy/delete callbacks. Contain Page/Selection tab state and all scale/presentation controls.
- `components/PdfStage.tsx`: retain pointer/render engine unchanged. Restyle only the surrounding HTML chrome (status bar, mode guidance, loading skeleton, empty state). Do NOT retokenize the canvas overlay draw colors (tag `#111827`, draft `#16a34a`, calibration `#dc2626`, legend fills) — they must stay byte-for-byte identical to the export overlay colors in `report/buildReport.ts`/`report/legendLayout.ts` so on-canvas and exported annotations keep matching. Facility polygon/swatch colors from `utils/colors.ts` are unchanged.
- Add `components/ModalDialog.tsx`: the single reusable native dialog wrapper used by shortcuts, dirty-work, and delete flows.
- Add `i18n/` (`i18n/messages.ts` + `i18n/index.ts`): `type Locale = 'ja' | 'en'`; a small vanilla-zustand `localeStore` (default `'ja'`, hydrated from and written to `localStorage['pdf-area-locale']`); a module-level `t(key, params?)` that reads the live locale (for imperative code such as App toasts/keydown) and a `useT()` hook that subscribes so components re-render on switch. `messages` holds one flat key→string map per locale covering every visible app string, with `{name}`/`{n}` interpolation. Missing keys fall back to the `ja` string. No third-party i18n library.
- `state/types.ts` / `state/store.ts`: add `savedFingerprint`, `markProjectSaved`, `toProjectFile`, `selectIsDirty`, `DeletedAreaSnapshot`, and the `deleteArea`/`restoreDeletedArea` snapshot contract. Do NOT change `ProjectFile` shape or persistence `version`. Keep exporting `aggregate` even though the Sidebar stops calling it (still unit-tested; removing it is unnecessary churn).
- `assets/main.css`: replace starter/global styling with the semantic system and responsive shell. Remove the `base.css` import and delete unused Electron starter assets/component only after the redesigned app smoke-tests.
- `src/main/index.ts`: set `minWidth: 960`, `minHeight: 680`; keep default 1200×820.
- `src/renderer/index.html`: set title `面積計測`.

Do not split the 800-line `PdfStage` pointer FSM during this redesign; that is independent regression risk. Do not add a router, CSS framework, component library, icon pack, third-party localization library, autosave service, or E2E dependency. (The switcher uses the in-house `i18n/` layer above, not a framework.)

## Error, empty, and edge behavior

- No PDF: action-focused empty state, scale/selection inspector disabled with explanatory text.
- No facilities: Facility tab asks for the first facility; closing a draft still uses the existing no-active-facility guard.
- No page areas: Area tab keeps Copy All disabled and explains facility/store behavior.
- No selection: Selection tab disabled; Page remains active.
- Unscaled page: persistent warning in Page inspector, canvas status, and report preview; existing report confirmation remains the final guard.
- Missing project PDF path: retain existing pending-project flow, but expose the recovery action in Japanese and do not clear current work before replacement is ready.
- Store code may be empty; list/tag behavior keeps the existing placeholder semantics.
- Store-label Off removes both visible tag and tag hit target, as today.
- Narrow drawer, dialogs, and menus close on Escape without changing drawing/tool state.
- Page change retains current store behavior for selection/pan unless explicitly changed elsewhere; this redesign does not alter geometry semantics.

## Verification design

From `C:/Repositories/pdf-area-calculator`:

1. `npx vitest run src/renderer/src/state/store.spec.ts src/renderer/src/state/storeLabel.spec.ts`
2. `npx vitest run src/renderer/src/components/PdfStage.spec.ts src/renderer/src/report/*.spec.ts src/renderer/src/geometry/area.spec.ts`
3. `npm run typecheck`
4. `npm run lint`
5. `npm run build`
6. `npm start` for built-Electron visual/behavior smoke.

Add `state/store.spec.ts` cases in the existing `createAreaStore` style: `toProjectFile` round-trips a known state; `selectIsDirty` is false after `loadDocument`/`importProject`/`markProjectSaved` and true after a persisted mutation (e.g. `addArea`) but false after a session-only change (e.g. `setTool`, `setZoom`, `selectArea`); `deleteArea` returns `{ area, index }` at the correct flat-array index and clears selection (the existing empty-after-delete assertion still holds); `restoreDeletedArea` reinserts at `min(index, length)` and reselects; `deleteArea`/`restoreDeletedArea` on an unknown id are safe no-ops. Do not add React Testing Library for this redesign.

Manual behavior smoke uses an external multi-page vector PDF because the repository has no PDF fixture:

- At 1200×820: open, facility add/activate, scale, draw facility/store, edit vertex/area/tag, copy/paste, legend, label mode, report preview, save/reopen, generate report, help, dialogs, and undo.
- At 960×680: right inspector is a reachable drawer; no toolbar clipping; left pane and canvas remain usable; no control disappears.
- Maximized: panes retain fixed widths; canvas receives extra space.
- Dirty guard: Cancel, Save failure/cancel, Save success, and Discard each produce the specified result without accidental replacement.
- Delete: Cancel preserves area; Confirm removes it; toast/`Ctrl+Z` restores original index for eight seconds; expiration and a second delete replace the snapshot.
- Keyboard-only: reach and operate File menu, tabs, segmented modes, drawer, dialogs, toast action, and all existing drawing shortcuts with a visible focus indicator.
- WCAG: verify all text/control boundaries against implemented computed colors; check 200% zoom, reduced motion, and non-color selected state.
- Report output remains source pages + one A4 summary, with the existing overlays, legends, store-label mode, and three aggregation sections unchanged.
