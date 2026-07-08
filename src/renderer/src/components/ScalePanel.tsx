import { useEffect, useMemo, useState } from 'react'

import { mmPerPtFor, useAreaStore } from '../state/store'
import type { Pt } from '../state/types'

interface ScalePanelProps {
  calibrationDraft: Pt[]
  onClearCalibration: () => void
}

const ratioPresets = [50, 100, 200, 250, 500, 1000]

function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function ScalePanel({ calibrationDraft, onClearCalibration }: ScalePanelProps): React.JSX.Element {
  const activePageIndex = useAreaStore((s) => s.activePageIndex)
  const pages = useAreaStore((s) => s.pages)
  const calibrating = useAreaStore((s) => s.calibrating)
  const setScale = useAreaStore((s) => s.setScale)
  const applyScaleToAll = useAreaStore((s) => s.applyScaleToAll)
  const setCalibrating = useAreaStore((s) => s.setCalibrating)
  const setPages = useAreaStore((s) => s.setPages)
  const mmPerPt = useAreaStore((s) => mmPerPtFor(s, s.activePageIndex))
  const page = pages[activePageIndex]
  const [ratio, setRatio] = useState('500')
  const [realMeters, setRealMeters] = useState('10')
  const [custom, setCustom] = useState('')

  useEffect(() => {
    if (mmPerPt != null) setCustom(String(Number(mmPerPt.toFixed(6))))
  }, [mmPerPt])

  const calibrationReady = calibrationDraft.length === 2 && Number(realMeters) > 0
  const status = useMemo(() => {
    if (mmPerPt == null) return 'Unscaled — areas shown in pt²'
    return `mmPerPt = ${mmPerPt.toFixed(4)} (1 pt ≈ ${(mmPerPt / 1000).toFixed(4)} m)`
  }, [mmPerPt])

  if (!page) {
    return <section className="panel scale-panel">Open a PDF to set page scale.</section>
  }

  return (
    <section className="panel scale-panel">
      <div className="panel__header">
        <h2>Scale</h2>
        <span>{status}</span>
      </div>

      <label className="field">
        <span>Page label</span>
        <input
          value={page.label}
          onChange={(event) => {
            const label = event.target.value
            setPages(pages.map((candidate) => (candidate.pageIndex === page.pageIndex ? { ...candidate, label } : candidate)))
          }}
        />
      </label>

      <details open>
        <summary>Drawing ratio</summary>
        <div className="inline-controls">
          <select value={ratio} onChange={(event) => setRatio(event.target.value)}>
            {ratioPresets.map((preset) => (
              <option key={preset} value={preset}>1:{preset}</option>
            ))}
          </select>
          <input inputMode="numeric" value={ratio} onChange={(event) => setRatio(event.target.value)} />
          <button
            type="button"
            onClick={() => {
              const n = Number(ratio)
              if (Number.isFinite(n) && n > 0) setScale(activePageIndex, { kind: 'ratio', n })
            }}
          >
            Set
          </button>
        </div>
      </details>

      <details>
        <summary>Calibration line</summary>
        <div className="stack">
          <button
            type="button"
            className={calibrating ? 'is-active' : ''}
            onClick={() => {
              onClearCalibration()
              setCalibrating(true)
            }}
          >
            Draw line
          </button>
          <p className="hint">
            Points: {calibrationDraft.length}/2
            {calibrationDraft.length === 2
              ? ` · ${distance(calibrationDraft[0], calibrationDraft[1]).toFixed(2)} pt`
              : ''}
          </p>
          <label className="field">
            <span>Real length (m)</span>
            <input inputMode="decimal" value={realMeters} onChange={(event) => setRealMeters(event.target.value)} />
          </label>
          <button
            type="button"
            disabled={!calibrationReady || distance(calibrationDraft[0], calibrationDraft[1]) === 0}
            onClick={() => {
              setScale(activePageIndex, {
                kind: 'calibration',
                a: calibrationDraft[0],
                b: calibrationDraft[1],
                realMeters: Number(realMeters)
              })
              setCalibrating(false)
            }}
          >
            Confirm calibration
          </button>
        </div>
      </details>

      <details>
        <summary>Custom factor</summary>
        <div className="inline-controls">
          <input inputMode="decimal" value={custom} onChange={(event) => setCustom(event.target.value)} />
          <button
            type="button"
            onClick={() => {
              const mmPerPtValue = Number(custom)
              if (Number.isFinite(mmPerPtValue) && mmPerPtValue > 0) {
                setScale(activePageIndex, { kind: 'custom', mmPerPt: mmPerPtValue })
              }
            }}
          >
            Set
          </button>
        </div>
      </details>

      <button type="button" className="secondary" disabled={mmPerPt == null} onClick={() => applyScaleToAll(activePageIndex)}>
        Apply to all pages
      </button>
    </section>
  )
}
