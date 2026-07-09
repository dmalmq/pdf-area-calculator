import { useRef, useState } from 'react'

import { aggregate, areaM2, colorForBusiness, useAreaStore } from '../state/store'
import { shoelacePt2 } from '../geometry/area'

function formatArea(value: number | null, pt2: number): string {
  return value == null ? `${pt2.toFixed(1)} pt²` : `${value.toFixed(2)} m²`
}

export function Sidebar(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const state = useAreaStore((s) => s)
  const activePageAreas = state.areas.filter((area) => area.pageIndex === state.activePageIndex)
  const selected = state.areas.find((area) => area.id === state.selectedAreaId) ?? null
  const rows = aggregate(state)

  const addBusiness = (): void => {
    state.addName(name)
    setName('')
    inputRef.current?.focus()
  }

  return (
    <aside className="sidebar">
      <section className="panel">
        <div className="panel__header">
          <h2>Businesses</h2>
          <span>{state.names.length}</span>
        </div>
        <div className="name-entry">
          <input
            ref={inputRef}
            value={name}
            placeholder="エスパル仙台本館"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addBusiness()
            }}
          />
          <button type="button" onClick={addBusiness}>Add</button>
        </div>
        <div className="chip-list">
          {state.names.map((candidate) => {
            const color = colorForBusiness(state, candidate)
            return (
              <div key={candidate} className="chip-row">
                <input
                  type="color"
                  value={color}
                  aria-label={`${candidate} color`}
                  onChange={(event) => state.setNameColor(candidate, event.target.value)}
                />
                <button
                  type="button"
                  className={state.activeName === candidate ? 'chip is-active' : 'chip'}
                  onClick={() => state.setActiveName(candidate)}
                >
                  <span style={{ background: color }} />
                  {candidate}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Areas on page</h2>
          <span>{activePageAreas.length}</span>
        </div>
        <div className="area-actions">
          <button
            type="button"
            disabled={activePageAreas.length === 0}
            onClick={() => state.copyActivePage()}
          >
            Copy all
          </button>
          <button
            type="button"
            disabled={state.clipboard.length === 0}
            onClick={() => state.pasteClipboard()}
          >
            Paste
          </button>
        </div>
        {activePageAreas.length === 0 ? (
          <p className="empty">Draw a polygon to create the first measured area.</p>
        ) : (
          <div className="area-list">
            {activePageAreas.map((area) => {
              const scaled = areaM2(state, area)
              return (
                <div key={area.id} className={state.selectedAreaId === area.id ? 'area-row is-selected' : 'area-row'}>
                  <button type="button" className="area-row__main" onClick={() => state.selectArea(area.id)}>
                    <span className="swatch" style={{ background: colorForBusiness(state, area.name) }} />
                    <span>
                      <strong>{area.name}</strong>
                      <small>{formatArea(scaled, shoelacePt2(area.polygon))}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      state.selectArea(area.id)
                      state.setTool('edit')
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="danger" onClick={() => state.deleteArea(area.id)}>
                    Delete
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {selected ? (
        <section className="panel selected-panel">
          <div className="panel__header">
            <h2>Selected area</h2>
            <span>{selected.polygon.length} vertices</span>
          </div>
          <label className="field">
            <span>Business</span>
            <select
              value={selected.name}
              onChange={(event) => {
                if (event.target.value === '__new__') {
                  inputRef.current?.focus()
                  return
                }
                state.renameArea(selected.id, event.target.value)
              }}
            >
              {state.names.map((candidate) => (
                <option key={candidate} value={candidate}>{candidate}</option>
              ))}
              <option value="__new__">Add new name…</option>
            </select>
          </label>
          <button type="button" onClick={() => state.copySelectedArea()}>
            Copy area
          </button>
          <button type="button" className="danger" onClick={() => state.deleteArea(selected.id)}>
            Delete selected area
          </button>
        </section>
      ) : null}

      <section className="panel summary-panel">
        <div className="panel__header">
          <h2>Summary preview</h2>
          <span>{rows.length}</span>
        </div>
        {rows.length === 0 ? (
          <p className="empty">Measured businesses will appear here before export.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>m²</th>
                <th>pt²</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.scaledM2.toFixed(2)}</td>
                  <td>{row.unscaledPt2 ? row.unscaledPt2.toExponential(2) : ''}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </aside>
  )
}
