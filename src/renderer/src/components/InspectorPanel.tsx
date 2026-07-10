import { useMemo, useState } from 'react'

import { useT } from '../i18n'
import { areaM2, mmPerPtFor, useAreaStore } from '../state/store'
import { areaNetPt2 } from '../geometry/area'
import type { Pt } from '../state/types'

interface InspectorPanelProps {
  calibrationDraft: Pt[]
  onClearCalibration: () => void
  onCopyArea: () => void
  onRequestDeleteArea: (id: string) => void
  onRenumberStores: () => void
  onAddHole: (id: string) => void
  drawerOpen: boolean
  hidden: boolean
}

type InspectorTab = 'page' | 'selection'

const ratioPresets = [50, 100, 200, 250, 500, 1000]

export function InspectorPanel({
  calibrationDraft,
  onClearCalibration,
  onCopyArea,
  onRequestDeleteArea,
  onRenumberStores,
  onAddHole,
  drawerOpen,
  hidden
}: InspectorPanelProps): React.JSX.Element {
  const t = useT()
  const activePageIndex = useAreaStore((s) => s.activePageIndex)
  const pages = useAreaStore((s) => s.pages)
  const names = useAreaStore((s) => s.names)
  const areas = useAreaStore((s) => s.areas)
  const selectedAreaId = useAreaStore((s) => s.selectedAreaId)
  const calibrating = useAreaStore((s) => s.calibrating)
  const setScale = useAreaStore((s) => s.setScale)
  const applyScaleToAll = useAreaStore((s) => s.applyScaleToAll)
  const setCalibrating = useAreaStore((s) => s.setCalibrating)
  const setPages = useAreaStore((s) => s.setPages)
  const setActivePage = useAreaStore((s) => s.setActivePage)
  const deletePage = useAreaStore((s) => s.deletePage)
  const movePage = useAreaStore((s) => s.movePage)
  const renameArea = useAreaStore((s) => s.renameArea)
  const setStoreCode = useAreaStore((s) => s.setStoreCode)
  const setAreaKind = useAreaStore((s) => s.setAreaKind)
  const removeHole = useAreaStore((s) => s.removeHole)
  const setAreaLabelOffset = useAreaStore((s) => s.setAreaLabelOffset)
  const legendVisible = useAreaStore((s) => s.legendVisible)
  const setLegendVisible = useAreaStore((s) => s.setLegendVisible)
  const legendOrientation = useAreaStore((s) => s.legendOrientation)
  const setLegendOrientation = useAreaStore((s) => s.setLegendOrientation)
  const legendScale = useAreaStore((s) => s.legendScale)
  const setLegendScale = useAreaStore((s) => s.setLegendScale)
  const storeLabelMode = useAreaStore((s) => s.storeLabelMode)
  const setStoreLabelMode = useAreaStore((s) => s.setStoreLabelMode)
  const mmPerPt = useAreaStore((s) => mmPerPtFor(s, s.pages[s.activePageIndex]?.pageIndex ?? 0))

  const page = pages[activePageIndex]
  const selected = areas.find((area) => area.id === selectedAreaId) ?? null

  const [userTab, setUserTab] = useState<InspectorTab | null>(null)
  const [ratio, setRatio] = useState('500')
  const [realMeters, setRealMeters] = useState('10')
  const [customEdited, setCustomEdited] = useState<string | null>(null)

  // Derived, not synced: this project's react-hooks lint bans setState-in-effect
  // and ref access during render. The inspector shows Selection while an area is
  // selected (until the user opens Page); the custom-factor field mirrors the
  // live scale until the user edits it.
  const tab: InspectorTab = selected ? (userTab ?? 'selection') : 'page'
  const custom = customEdited ?? (mmPerPt != null ? String(Number(mmPerPt.toFixed(6))) : '')

  const calibrationReady = calibrationDraft.length === 2 && Number(realMeters) > 0
  const calibrationDistance =
    calibrationDraft.length === 2
      ? Math.hypot(
          calibrationDraft[1].x - calibrationDraft[0].x,
          calibrationDraft[1].y - calibrationDraft[0].y
        )
      : 0
  const status = useMemo(() => {
    if (mmPerPt == null) return t('scale.statusUnscaled')
    return t('scale.statusScaled', { m: (mmPerPt / 1000).toFixed(4), mmPerPt: mmPerPt.toFixed(4) })
  }, [mmPerPt, t])

  const selectedMeasure =
    selected == null
      ? ''
      : (() => {
          const scaled = areaM2({ pages }, selected)
          return scaled == null
            ? `${areaNetPt2(selected).toFixed(1)} pt²`
            : `${scaled.toFixed(2)} m²`
        })()

  return (
    <aside className={drawerOpen ? 'inspector is-open' : 'inspector'} inert={hidden}>
      <div className="tabs" role="tablist">
        <button
          type="button"
          className="tab"
          role="tab"
          aria-selected={tab === 'page'}
          onClick={() => setUserTab('page')}
        >
          {t('inspector.tab.page')}
        </button>
        <button
          type="button"
          className="tab"
          role="tab"
          aria-selected={tab === 'selection'}
          disabled={!selected}
          onClick={() => setUserTab('selection')}
        >
          {t('inspector.tab.selection')}
        </button>
      </div>

      {tab === 'page' ? (
        <div className="pane-scroll">
          {!page ? (
            <p className="empty">{t('scale.openPdfFirst')}</p>
          ) : (
            <>
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

              <p className={mmPerPt == null ? 'warning-note' : 'hint'}>{status}</p>

              <label className="field">
                <span>{t('page.label')}</span>
                <input
                  value={page.label}
                  onChange={(event) => {
                    const label = event.target.value
                    setPages(
                      pages.map((candidate) =>
                        candidate.pageIndex === page.pageIndex ? { ...candidate, label } : candidate
                      )
                    )
                  }}
                />
              </label>

              <details className="disclosure" open>
                <summary>{t('scale.ratio')}</summary>
                <div className="inline-controls">
                  <select value={ratio} onChange={(event) => setRatio(event.target.value)}>
                    {ratioPresets.map((preset) => (
                      <option key={preset} value={preset}>
                        1:{preset}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="numeric"
                    value={ratio}
                    onChange={(event) => setRatio(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const n = Number(ratio)
                      if (Number.isFinite(n) && n > 0)
                        setScale(page.pageIndex, { kind: 'ratio', n })
                    }}
                  >
                    {t('scale.set')}
                  </button>
                </div>
              </details>

              <details className="disclosure">
                <summary>{t('scale.calibration')}</summary>
                <button
                  type="button"
                  className="btn btn--block"
                  aria-pressed={calibrating}
                  onClick={() => {
                    onClearCalibration()
                    setCalibrating(true)
                  }}
                >
                  {t('scale.drawLine')}
                </button>
                <p className="hint">
                  {calibrationDraft.length === 2
                    ? t('scale.pointsWithDist', {
                        n: calibrationDraft.length,
                        dist: calibrationDistance.toFixed(2)
                      })
                    : t('scale.points', { n: calibrationDraft.length })}
                </p>
                <label className="field">
                  <span>{t('scale.realLength')}</span>
                  <input
                    inputMode="decimal"
                    value={realMeters}
                    onChange={(event) => setRealMeters(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--block"
                  disabled={!calibrationReady || calibrationDistance === 0}
                  onClick={() => {
                    setScale(page.pageIndex, {
                      kind: 'calibration',
                      a: calibrationDraft[0],
                      b: calibrationDraft[1],
                      realMeters: Number(realMeters)
                    })
                    setCalibrating(false)
                  }}
                >
                  {t('scale.confirm')}
                </button>
              </details>

              <details className="disclosure">
                <summary>{t('scale.custom')}</summary>
                <div className="inline-controls">
                  <input
                    inputMode="decimal"
                    value={custom}
                    onChange={(event) => setCustomEdited(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const value = Number(custom)
                      if (Number.isFinite(value) && value > 0)
                        setScale(page.pageIndex, { kind: 'custom', mmPerPt: value })
                    }}
                  >
                    {t('scale.set')}
                  </button>
                </div>
              </details>

              <button
                type="button"
                className="btn btn--block"
                disabled={mmPerPt == null}
                onClick={() => applyScaleToAll(page.pageIndex)}
              >
                {t('scale.applyAll')}
              </button>

              <div className="pane-section" style={{ marginTop: 'var(--space-4)' }}>
                <div className="pane-section__head">
                  <h2>{t('legend.heading')}</h2>
                </div>
                <button
                  type="button"
                  className="btn btn--block"
                  aria-pressed={legendVisible}
                  onClick={() => setLegendVisible(!legendVisible)}
                >
                  {t('legend.show')}
                </button>
                <div className="inline-controls" style={{ marginTop: 'var(--space-2)' }}>
                  <div className="segmented" role="group" aria-label={t('legend.heading')}>
                    <button
                      type="button"
                      className="segmented__option"
                      aria-pressed={legendOrientation === 'vertical'}
                      onClick={() => setLegendOrientation('vertical')}
                    >
                      {t('legend.vertical')}
                    </button>
                    <button
                      type="button"
                      className="segmented__option"
                      aria-pressed={legendOrientation === 'horizontal'}
                      onClick={() => setLegendOrientation('horizontal')}
                    >
                      {t('legend.horizontal')}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn--icon"
                    aria-label={t('legend.smaller')}
                    onClick={() => setLegendScale(legendScale / 1.25)}
                  >
                    A−
                  </button>
                  <span className="muted" style={{ minWidth: 44, textAlign: 'center' }}>
                    {Math.round(legendScale * 100)}%
                  </span>
                  <button
                    type="button"
                    className="btn btn--icon"
                    aria-label={t('legend.larger')}
                    onClick={() => setLegendScale(legendScale * 1.25)}
                  >
                    A+
                  </button>
                </div>
              </div>

              <div className="pane-section">
                <div className="pane-section__head">
                  <h2>{t('storeLabel.heading')}</h2>
                </div>
                <div className="segmented" role="group" aria-label={t('storeLabel.heading')}>
                  <button
                    type="button"
                    className="segmented__option"
                    aria-pressed={storeLabelMode === 'code'}
                    onClick={() => setStoreLabelMode('code')}
                  >
                    {t('storeLabel.code')}
                  </button>
                  <button
                    type="button"
                    className="segmented__option"
                    aria-pressed={storeLabelMode === 'number'}
                    onClick={() => setStoreLabelMode('number')}
                  >
                    {t('storeLabel.number')}
                  </button>
                  <button
                    type="button"
                    className="segmented__option"
                    aria-pressed={storeLabelMode === 'off'}
                    onClick={() => setStoreLabelMode('off')}
                  >
                    {t('storeLabel.off')}
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn--block"
                  style={{ marginTop: 'var(--space-2)' }}
                  onClick={onRenumberStores}
                >
                  {t('storeLabel.renumber')}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {tab === 'selection' ? (
        <div className="pane-scroll">
          {!selected ? (
            <p className="empty">{t('selection.none')}</p>
          ) : (
            <>
              <div className="pane-section__head">
                <h2>{selected.kind === 'store' ? t('kind.store') : t('kind.facility')}</h2>
                <span className="count">
                  {t('selection.vertices', { n: selected.polygon.length })}
                </span>
              </div>

              <div className="field">
                <span>{t('selection.type')}</span>
                <div className="segmented" role="group" aria-label={t('selection.type')}>
                  <button
                    type="button"
                    className="segmented__option"
                    aria-pressed={selected.kind === 'facility'}
                    onClick={() => setAreaKind(selected.id, 'facility')}
                  >
                    {t('kind.facility')}
                  </button>
                  <button
                    type="button"
                    className="segmented__option"
                    aria-pressed={selected.kind === 'store'}
                    onClick={() => setAreaKind(selected.id, 'store')}
                  >
                    {t('kind.store')}
                  </button>
                </div>
              </div>

              <label className="field">
                <span>{t('selection.facility')}</span>
                <select
                  value={selected.name}
                  onChange={(event) => renameArea(selected.id, event.target.value)}
                >
                  {names.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate}
                    </option>
                  ))}
                </select>
              </label>

              {selected.kind === 'store' ? (
                <label className="field">
                  <span>{t('selection.storeCode')}</span>
                  <input
                    value={selected.code ?? ''}
                    onChange={(event) => setStoreCode(selected.id, event.target.value)}
                  />
                </label>
              ) : null}

              <div className="summary-row">
                <span>{t('selection.area')}</span>
                <span className="row__metric">{selectedMeasure}</span>
              </div>

              <button
                type="button"
                className="btn btn--block"
                style={{ marginTop: 'var(--space-3)' }}
                onClick={() => setAreaLabelOffset(selected.id, { x: 0, y: 0 })}
              >
                {t('selection.resetLabel')}
              </button>
              <button
                type="button"
                className="btn btn--block"
                style={{ marginTop: 'var(--space-2)' }}
                onClick={() => onAddHole(selected.id)}
              >
                {t('selection.addHole')}
              </button>
              {selected.holes?.length
                ? selected.holes.map((_, index) => (
                    <div key={index} className="summary-row">
                      <span>{`${t('selection.hole')} ${index + 1}`}</span>
                      <button
                        type="button"
                        className="btn btn--icon"
                        aria-label={t('selection.removeHole')}
                        title={t('selection.removeHole')}
                        onClick={() => removeHole(selected.id, index)}
                      >
                        ×
                      </button>
                    </div>
                  ))
                : null}
              <button
                type="button"
                className="btn btn--block"
                style={{ marginTop: 'var(--space-2)' }}
                onClick={onCopyArea}
              >
                {t('selection.copy')}
              </button>
              <button
                type="button"
                className="btn btn--danger btn--block"
                style={{ marginTop: 'var(--space-2)' }}
                onClick={() => onRequestDeleteArea(selected.id)}
              >
                {t('selection.delete')}
              </button>
            </>
          )}
        </div>
      ) : null}
    </aside>
  )
}
