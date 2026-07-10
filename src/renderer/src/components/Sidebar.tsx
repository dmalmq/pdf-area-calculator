import { useRef, useState } from 'react'

import { useT } from '../i18n'
import {
  areaM2,
  colorForBusiness,
  reportByFacility,
  reportByFacilityLevel,
  reportByLevel,
  useAreaStore
} from '../state/store'
import { shoelacePt2 } from '../geometry/area'

type LeftTab = 'facilities' | 'areas' | 'report'

interface SidebarProps {
  onCopyAll: () => void
  onPaste: () => void
}

export function Sidebar({ onCopyAll, onPaste }: SidebarProps): React.JSX.Element {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<LeftTab>('facilities')
  const [name, setName] = useState('')
  const state = useAreaStore((s) => s)

  const activeSource = state.pages[state.activePageIndex]?.pageIndex
  const activePageAreas = state.areas.filter((area) => area.pageIndex === activeSource)

  const addFacility = (): void => {
    state.addName(name)
    setName('')
    inputRef.current?.focus()
  }

  return (
    <aside className="leftpane">
      <div className="tabs" role="tablist">
        <button
          type="button"
          className="tab"
          role="tab"
          aria-selected={tab === 'facilities'}
          onClick={() => setTab('facilities')}
        >
          {t('tab.facilities')}
        </button>
        <button
          type="button"
          className="tab"
          role="tab"
          aria-selected={tab === 'areas'}
          onClick={() => setTab('areas')}
        >
          {t('tab.areas')}
        </button>
        <button
          type="button"
          className="tab"
          role="tab"
          aria-selected={tab === 'report'}
          onClick={() => setTab('report')}
        >
          {t('tab.report')}
        </button>
      </div>

      {tab === 'facilities' ? (
        <>
          <div className="pane-scroll">
            <div className="name-entry">
              <input
                ref={inputRef}
                value={name}
                placeholder={t('facilities.namePlaceholder')}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addFacility()
                }}
              />
              <button type="button" className="btn" onClick={addFacility}>
                {t('facilities.add')}
              </button>
            </div>
            {state.names.length === 0 ? (
              <p className="empty" style={{ marginTop: 'var(--space-3)' }}>
                {t('facilities.empty')}
              </p>
            ) : (
              <div className="chip-list">
                {state.names.map((candidate) => {
                  const color = colorForBusiness(state, candidate)
                  return (
                    <div key={candidate} className="chip-row">
                      <input
                        type="color"
                        value={color}
                        aria-label={t('facilities.colorLabel', { name: candidate })}
                        onChange={(event) => state.setNameColor(candidate, event.target.value)}
                      />
                      <button
                        type="button"
                        className="chip"
                        aria-pressed={state.activeName === candidate}
                        onClick={() => state.setActiveName(candidate)}
                      >
                        <span className="swatch" style={{ background: color }} />
                        <span className="label">{candidate}</span>
                      </button>
                      <input
                        className="prefix-input"
                        value={state.prefixes[candidate] ?? ''}
                        placeholder={t('facilities.prefixPlaceholder')}
                        aria-label={t('facilities.prefixLabel', { name: candidate })}
                        onChange={(event) => state.setFacilityPrefix(candidate, event.target.value)}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="pane-foot">
            {state.activeName ? (
              <>
                <strong>{t('facilities.active', { name: state.activeName })}</strong>
                <span className="muted">{t('facilities.activeHint')}</span>
              </>
            ) : (
              <span className="muted">{t('facilities.none')}</span>
            )}
          </div>
        </>
      ) : null}

      {tab === 'areas' ? (
        <div className="pane-scroll">
          <div className="area-actions">
            <button
              type="button"
              className="btn"
              disabled={activePageAreas.length === 0}
              onClick={onCopyAll}
            >
              {t('areas.copyAll')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={state.clipboard.length === 0}
              onClick={onPaste}
            >
              {t('areas.paste')}
            </button>
          </div>
          {activePageAreas.length === 0 ? (
            <p className="empty">{t('areas.empty')}</p>
          ) : (
            <div className="list">
              {activePageAreas.map((area) => {
                const scaled = areaM2(state, area)
                const measure =
                  scaled == null
                    ? `${shoelacePt2(area.polygon).toFixed(1)} pt²`
                    : `${scaled.toFixed(2)} m²`
                return (
                  <div
                    key={area.id}
                    className={state.selectedAreaId === area.id ? 'row row--selected' : 'row'}
                  >
                    <button
                      type="button"
                      className="row__main"
                      onClick={() => state.selectArea(area.id)}
                    >
                      <span
                        className="swatch"
                        style={{ background: colorForBusiness(state, area.name) }}
                      />
                      <span>
                        <strong>
                          {area.kind === 'store' ? area.code || t('areas.noCode') : area.name}
                        </strong>
                        <small>
                          {area.kind === 'store'
                            ? t('areas.storeParent', { name: area.name })
                            : measure}
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => {
                        state.selectArea(area.id)
                        state.setTool('edit')
                      }}
                    >
                      {t('areas.edit')}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'report' ? (
        <div className="pane-scroll">
          {state.areas.length === 0 ? (
            <p className="empty">{t('report.empty')}</p>
          ) : (
            <>
              <div className="summary-group">
                <h3>{t('report.byLevel')}</h3>
                {reportByLevel(state).map((row) => (
                  <div key={row.level} className="summary-row">
                    <span>{row.level}</span>
                    <span className="row__metric">{row.areaM2.toFixed(2)} m²</span>
                    <small>
                      {t('report.colFacilities')} {row.facilities} · {t('report.colStores')}{' '}
                      {row.stores}
                      {row.unscaledPt2 ? ` · ${row.unscaledPt2.toFixed(1)} pt²` : ''}
                    </small>
                  </div>
                ))}
              </div>

              <div className="summary-group">
                <h3>{t('report.byFacility')}</h3>
                {reportByFacility(state).map((row) => (
                  <div key={row.name} className="summary-row">
                    <span>{row.name}</span>
                    <span className="row__metric">{row.areaM2.toFixed(2)} m²</span>
                    <small>
                      {row.levels.join(', ')} · {t('report.colStores')} {row.stores}
                      {row.unscaledPt2 ? ` · ${row.unscaledPt2.toFixed(1)} pt²` : ''}
                    </small>
                  </div>
                ))}
              </div>

              <div className="summary-group">
                <h3>{t('report.byFacilityLevel')}</h3>
                {reportByFacilityLevel(state).map((row) => (
                  <div key={`${row.name}__${row.level}`} className="summary-row">
                    <span>
                      {row.name} · {row.level}
                    </span>
                    <span className="row__metric">{row.areaM2.toFixed(2)} m²</span>
                    <small>
                      {t('report.colStores')} {row.stores}
                      {row.unscaledPt2 ? ` · ${row.unscaledPt2.toFixed(1)} pt²` : ''}
                    </small>
                  </div>
                ))}
              </div>

              {reportByLevel(state).some((row) => row.unscaledPt2 > 0) ? (
                <p className="warning-note">{t('report.unscaledNote')}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </aside>
  )
}
