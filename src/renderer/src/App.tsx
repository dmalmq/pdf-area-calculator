import { useCallback, useEffect, useRef, useState } from 'react'

import { PdfStage } from './components/PdfStage'
import { ScalePanel } from './components/ScalePanel'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { buildReportPdf } from './report/buildReport'
import { renderTablePng } from './report/tableImage'
import { aggregate, areaStore, mmPerPtFor, useAreaStore } from './state/store'
import type { ProjectFile, Pt, Tool } from './state/types'

const shortcutRows = [
  ['D', 'Switch to draw tool'],
  ['E', 'Switch to edit tool'],
  ['P / Space hold', 'Pan tool / temporary pan'],
  ['[ / ]', 'Previous / next page'],
  ['+ / - / 0', 'Zoom in / out / fit'],
  ['Backspace', 'Undo drawing vertex or remove selected edit vertex'],
  ['Delete', 'Delete selected area'],
  ['Enter', 'Close in-progress polygon'],
  ['Esc', 'Cancel, deselect, or close this overlay'],
  ['F / S', 'Draw kind: facility / store'],
  ['Ctrl/Cmd + C', 'Copy selected area, or whole page if none selected'],
  ['Ctrl/Cmd + V', 'Paste areas onto the current page'],
  ['Drag area (Edit tool)', 'Move the whole area — hold Shift to lock the axis']
]

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function withoutExt(name: string): string {
  return name.replace(/\.pdf$/i, '')
}

function App(): React.JSX.Element {
  const [toast, setToast] = useState<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [calibrationDraft, setCalibrationDraft] = useState<Pt[]>([])
  const [pendingProject, setPendingProject] = useState<ProjectFile | null>(null)
  const previousTool = useRef<Tool | null>(null)
  const fileName = useAreaStore((s) => s.fileName)
  const pages = useAreaStore((s) => s.pages)
  const areas = useAreaStore((s) => s.areas)
  const names = useAreaStore((s) => s.names)

  const showToast = useCallback((message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 3200)
  }, [])

  const openPdf = async (): Promise<void> => {
    const result = await window.api.openPdf()
    if (!result) return
    const name = baseName(result.path)
    await areaStore.getState().loadDocument(new Uint8Array(result.bytes), name)
    areaStore.setState({ pdfPath: result.path })
    if (pendingProject) {
      if (pendingProject.fileName && pendingProject.fileName !== name) {
        showToast(`Project references ${pendingProject.fileName}; applying it to ${name}`)
      }
      areaStore.getState().importProject({ ...pendingProject, fileName: name, pdfPath: result.path })
      setPendingProject(null)
    }
    setCalibrationDraft([])
    showToast(`Opened ${name}`)
  }

  const saveProject = async (): Promise<void> => {
    const state = areaStore.getState()
    const project: ProjectFile = {
      version: 2,
      fileName: state.fileName,
      pdfPath: state.pdfPath,
      pages: state.pages,
      areas: state.areas,
      names: state.names,
      colors: state.colors,
      prefixes: state.prefixes,
      legendPos: state.legendPos,
      legendVisible: state.legendVisible
    }
    const defaultName = `${withoutExt(state.fileName ?? 'pdf-area-calculator')}_project.json`
    const saved = await window.api.saveProject(project, defaultName)
    if (saved) showToast(`Project saved to ${baseName(saved)}`)
  }

  const openProject = async (): Promise<void> => {
    const project = await window.api.openProject()
    if (!project) return

    areaStore.getState().importProject(project)
    setCalibrationDraft([])

    if (project.pdfPath) {
      try {
        const result = await window.api.openPdfPath(project.pdfPath)
        if (result) {
          const name = baseName(result.path)
          await areaStore.getState().loadDocument(new Uint8Array(result.bytes), name)
          areaStore.getState().importProject({ ...project, fileName: name, pdfPath: result.path })
          if (project.fileName && project.fileName !== name) {
            showToast(`Project references ${project.fileName}; opened ${name}`)
          } else {
            showToast(`Opened ${name}`)
          }
        } else {
          setPendingProject(project)
          showToast(`Could not open ${project.pdfPath}. Open it manually via Open.`)
        }
      } catch {
        setPendingProject(project)
        showToast(`Could not open ${project.pdfPath}. Open it manually via Open.`)
      }
    } else {
      setPendingProject(project)
      showToast('Project saved without a PDF path. Open the PDF via Open.')
    }
  }

  const generateReport = async (): Promise<void> => {
    const state = areaStore.getState()
    if (!state.originalBytes) {
      showToast('Open a PDF before generating a report')
      return
    }
    const rows = aggregate(state)
    if (!rows.length) return
    const unscaledCount = state.areas.filter((area) => mmPerPtFor(state, area.pageIndex) == null).length
    const includeUnscaled = unscaledCount > 0
    if (includeUnscaled) {
      const ok = window.confirm(
        `${unscaledCount} polygons are on unscaled pages and will be reported in pt², not m². Continue?`
      )
      if (!ok) return
    }
    const title = `面積集計 — ${state.fileName ?? 'PDF'}`
    const png = await renderTablePng(rows, title, includeUnscaled)
    const pdf = await buildReportPdf(state.originalBytes, png, state.areas, state.colors)
    const defaultName = `${withoutExt(state.fileName ?? 'pdf')}_areas.pdf`
    const saved = await window.api.savePdf(pdf, defaultName)
    if (saved) showToast(`Report saved to ${baseName(saved)}`)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      const editingText = target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
      if (editingText && event.key !== 'Escape') return

      const state = areaStore.getState()

      if (shortcutsOpen) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setShortcutsOpen(false)
        }
        return
      }

      if (event.key === '?') {
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }

      if (event.key === ' ') {
        if (!event.repeat) {
          event.preventDefault()
          previousTool.current = state.tool
          state.setTool('pan')
        }
        return
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
        event.preventDefault()
        const count = state.selectedAreaId ? state.copySelectedArea() : state.copyActivePage()
        showToast(count ? `Copied ${count} area${count === 1 ? '' : 's'}` : 'No areas to copy')
        return
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) {
        event.preventDefault()
        const count = state.pasteClipboard()
        showToast(count ? `Pasted ${count} area${count === 1 ? '' : 's'}` : 'Nothing to paste')
        return
      }

      if (event.key === 'D' || event.key === 'd') state.setTool('draw')
      else if (event.key === 'E' || event.key === 'e') state.setTool('edit')
      else if (event.key === 'P' || event.key === 'p') state.setTool('pan')
      else if (event.key === 'F' || event.key === 'f') state.setDrawKind('facility')
      else if (event.key === 'S' || event.key === 's') state.setDrawKind('store')
      else if (event.key === '[') state.setActivePage(state.activePageIndex - 1)
      else if (event.key === ']') state.setActivePage(state.activePageIndex + 1)
      else if (event.key === '+' || event.key === '=') state.setZoom(state.zoom * 1.2)
      else if (event.key === '-') state.setZoom(state.zoom / 1.2)
      else if (event.key === '0') {
        state.setZoom(1)
        state.setPan({ x: 0, y: 0 })
      } else if (event.key === 'Delete' && state.selectedAreaId) state.deleteArea(state.selectedAreaId)
      else if (event.key === 'Escape') {
        if (state.tool === 'edit') state.setTool('draw')
        else if (state.selectedAreaId) state.selectArea(null)
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== ' ' || !previousTool.current) return
      areaStore.getState().setTool(previousTool.current)
      previousTool.current = null
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [shortcutsOpen, showToast])

  return (
    <div className="app-shell">
      <Toolbar
        onOpenPdf={openPdf}
        onSaveProject={saveProject}
        onOpenProject={openProject}
        onGenerateReport={generateReport}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <div className="workspace">
        <Sidebar />
        <PdfStage
          calibrationDraft={calibrationDraft}
          onCalibrationPoint={(pt) => {
            setCalibrationDraft((current) => {
              const next = current.length >= 2 ? [pt] : [...current, pt]
              if (next.length === 2) areaStore.getState().setCalibrating(false)
              return next
            })
          }}
          onToast={showToast}
        />
        <ScalePanel calibrationDraft={calibrationDraft} onClearCalibration={() => setCalibrationDraft([])} />
      </div>

      {shortcutsOpen ? (
        <div className="modal-backdrop" onMouseDown={() => setShortcutsOpen(false)}>
          <section className="shortcuts-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel__header">
              <h2>Keyboard shortcuts</h2>
              <button type="button" onClick={() => setShortcutsOpen(false)}>
                Close
              </button>
            </div>
            <table>
              <tbody>
                {shortcutRows.map(([key, action]) => (
                  <tr key={key}>
                    <th>{key}</th>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
      <div className="sr-only" aria-live="polite">
        {fileName ? `${fileName}, ${pages.length} pages, ${areas.length} areas, ${names.length} businesses` : 'No PDF open'}
      </div>
    </div>
  )
}

export default App
