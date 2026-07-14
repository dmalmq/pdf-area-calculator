import { useCallback, useEffect, useRef, useState } from 'react'

import { InspectorPanel } from './components/InspectorPanel'
import { ModalDialog } from './components/ModalDialog'
import { PdfStage } from './components/PdfStage'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { shouldUseNativeDetailPaste } from './components/detailView'
import { t, useT } from './i18n'
import { buildReportPdf } from './report/buildReport'
import { renderReportPng } from './report/reportImage'
import {
  areaStore,
  facilitiesOnPage,
  mmPerPtFor,
  orderedDetailPages,
  selectIsDirty,
  toProjectFile,
  useAreaStore
} from './state/store'
import type { BusyAction, ProjectFile, Pt, Tool } from './state/types'

type ReplaceChoice = 'save' | 'discard' | 'cancel'

interface ToastState {
  message: string
  action?: { label: string; run: () => void }
}

const shortcutRows: [string, string][] = [
  ['D', 'shortcuts.draw'],
  ['E', 'shortcuts.edit'],
  ['P / Space', 'shortcuts.pan'],
  ['[ / ]', 'shortcuts.pages'],
  ['+ / − / 0', 'shortcuts.zoom'],
  ['Backspace', 'shortcuts.backspace'],
  ['Delete', 'shortcuts.delete'],
  ['Enter', 'shortcuts.enter'],
  ['Esc', 'shortcuts.escape'],
  ['F / S', 'shortcuts.kind'],
  ['T', 'shortcuts.tags'],
  ['Ctrl/Cmd + C', 'shortcuts.copy'],
  ['Ctrl/Cmd + V', 'shortcuts.paste'],
  ['Ctrl/Cmd + Z', 'shortcuts.undo'],
  ['Ctrl/Cmd + Shift + Z', 'shortcuts.redo'],
  ['Drag (Edit)', 'shortcuts.dragArea'],
  ['Drag tag (Edit)', 'shortcuts.dragTag'],
  ['Double-click', 'shortcuts.selectArea']
]

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function withoutExt(name: string): string {
  return name.replace(/\.pdf$/i, '')
}

function App(): React.JSX.Element {
  const tt = useT()
  const [toast, setToast] = useState<ToastState | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [calibrationDraft, setCalibrationDraft] = useState<Pt[]>([])
  const [pendingProject, setPendingProject] = useState<ProjectFile | null>(null)
  const [busy, setBusy] = useState<BusyAction | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1179px)').matches)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [holeTarget, setHoleTarget] = useState<string | null>(null)
  const [renumberOpen, setRenumberOpen] = useState(false)
  const previousTool = useRef<Tool | null>(null)
  const replaceResolver = useRef<((choice: ReplaceChoice) => void) | null>(null)

  const fileName = useAreaStore((s) => s.fileName)
  const pages = useAreaStore((s) => s.pages)
  const areas = useAreaStore((s) => s.areas)
  const names = useAreaStore((s) => s.names)
  const canUndo = useAreaStore((s) => s.undoStack.length > 0)
  const canRedo = useAreaStore((s) => s.redoStack.length > 0)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1179px)')
    const onChange = (event: MediaQueryListEvent): void => setNarrow(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const showToast = useCallback((message: string): void => {
    setToast({ message })
    window.setTimeout(
      () =>
        setToast((current) =>
          current && !current.action && current.message === message ? null : current
        ),
      3200
    )
  }, [])

  const saveProject = useCallback(async (): Promise<boolean> => {
    setBusy('save-project')
    try {
      const state = areaStore.getState()
      const project = toProjectFile(state)
      const defaultName = `${withoutExt(state.fileName ?? 'pdf-area-calculator')}_project.json`
      const saved = await window.api.saveProject(project, defaultName)
      if (!saved) return false
      areaStore.getState().markProjectSaved()
      showToast(t('toast.projectSaved', { name: baseName(saved) }))
      return true
    } finally {
      setBusy(null)
    }
  }, [showToast])

  const confirmReplaceIfDirty = useCallback(async (): Promise<boolean> => {
    if (!selectIsDirty(areaStore.getState())) return true
    const choice = await new Promise<ReplaceChoice>((resolve) => {
      replaceResolver.current = resolve
      setReplaceOpen(true)
    })
    setReplaceOpen(false)
    replaceResolver.current = null
    if (choice === 'cancel') return false
    if (choice === 'discard') return true
    return saveProject()
  }, [saveProject])

  const openPdf = useCallback(async (): Promise<void> => {
    if (!(await confirmReplaceIfDirty())) return
    setBusy('open-pdf')
    try {
      const result = await window.api.openPdf()
      if (!result) return
      const name = baseName(result.path)
      await areaStore.getState().loadDocument(new Uint8Array(result.bytes), name)
      areaStore.setState({ pdfPath: result.path })
      if (pendingProject) {
        if (pendingProject.fileName && pendingProject.fileName !== name) {
          showToast(t('toast.projectRefApplied', { ref: pendingProject.fileName, name }))
        }
        areaStore
          .getState()
          .importProject({ ...pendingProject, fileName: name, pdfPath: result.path })
        setPendingProject(null)
      }
      setCalibrationDraft([])
      showToast(t('toast.opened', { name }))
    } finally {
      setBusy(null)
    }
  }, [confirmReplaceIfDirty, pendingProject, showToast])

  const openProject = useCallback(async (): Promise<void> => {
    if (!(await confirmReplaceIfDirty())) return
    setBusy('open-project')
    try {
      const project = await window.api.openProject()
      if (!project) return
      areaStore.getState().importProject(project)
      setCalibrationDraft([])
      if (!project.pdfPath) {
        setPendingProject(project)
        showToast(t('toast.projectNoPath', { open: t('file.openPdf') }))
        return
      }
      try {
        const result = await window.api.openPdfPath(project.pdfPath)
        if (result) {
          const name = baseName(result.path)
          await areaStore.getState().loadDocument(new Uint8Array(result.bytes), name)
          areaStore.getState().importProject({ ...project, fileName: name, pdfPath: result.path })
          showToast(
            project.fileName && project.fileName !== name
              ? t('toast.projectRefOpened', { ref: project.fileName, name })
              : t('toast.opened', { name })
          )
        } else {
          setPendingProject(project)
          showToast(t('toast.projectOpenFail', { path: project.pdfPath, open: t('file.openPdf') }))
        }
      } catch {
        setPendingProject(project)
        showToast(t('toast.projectOpenFail', { path: project.pdfPath, open: t('file.openPdf') }))
      }
    } finally {
      setBusy(null)
    }
  }, [confirmReplaceIfDirty, showToast])

  const generateReport = useCallback(async (): Promise<void> => {
    const state = areaStore.getState()
    if (!state.originalBytes) {
      showToast(t('toast.openBeforeReport'))
      return
    }
    if (!state.areas.length) return
    const unscaledCount = state.areas.filter(
      (area) => area.kind === 'facility' && mmPerPtFor(state, area.pageIndex) == null
    ).length
    if (unscaledCount > 0 && !window.confirm(t('confirm.unscaled', { n: unscaledCount }))) return
    setBusy('generate-report')
    try {
      const title = `面積集計 — ${state.fileName ?? 'PDF'}`
      const png = await renderReportPng(state, title)
      const detailPages = orderedDetailPages(state)
      const pdf = await buildReportPdf(
        state.originalBytes,
        png,
        state.areas,
        state.colors,
        {
          visible: state.legendVisible,
          pos: state.legendPos,
          entriesForPage: (pageIndex) => facilitiesOnPage(state, pageIndex),
          orientation: state.legendOrientation,
          scale: state.legendScale
        },
        { mode: state.storeLabelMode, prefixes: state.prefixes },
        state.pages.map((page) => page.pageIndex),
        {
          pages: detailPages,
          areas: state.areas,
          pageLabels: state.pages.reduce<string[]>((labels, page) => {
            labels[page.pageIndex] = page.label
            return labels
          }, []),
          sourcePages: state.pages
        }
      )
      const defaultName = `${withoutExt(state.fileName ?? 'pdf')}_areas.pdf`
      const saved = await window.api.savePdf(pdf, defaultName)
      if (saved) showToast(t('toast.reportSaved', { name: baseName(saved) }))
    } finally {
      setBusy(null)
    }
  }, [showToast])

  const copyAll = useCallback((): void => {
    const count = areaStore.getState().copyActivePage()
    showToast(
      count
        ? t(count === 1 ? 'toast.copied.one' : 'toast.copied.other', { n: count })
        : t('toast.noCopy')
    )
  }, [showToast])

  const copySelected = useCallback((): void => {
    const count = areaStore.getState().copySelectedArea()
    showToast(
      count
        ? t(count === 1 ? 'toast.copied.one' : 'toast.copied.other', { n: count })
        : t('toast.noCopy')
    )
  }, [showToast])

  const copyContextual = useCallback((): void => {
    const state = areaStore.getState()
    const count = state.selectedAreaIds.length ? state.copySelectedArea() : state.copyActivePage()
    showToast(
      count
        ? t(count === 1 ? 'toast.copied.one' : 'toast.copied.other', { n: count })
        : t('toast.noCopy')
    )
  }, [showToast])

  const paste = useCallback((): void => {
    const count = areaStore.getState().pasteClipboard()
    showToast(
      count
        ? t(count === 1 ? 'toast.pasted.one' : 'toast.pasted.other', { n: count })
        : t('toast.noPaste')
    )
  }, [showToast])

  const requestDeleteAreas = useCallback(
    (ids: string[]): void => {
      areaStore.getState().deleteAreas(ids)
      showToast(t('toast.deleted'))
    },
    [showToast]
  )

  const startHole = useCallback((id: string): void => {
    setHoleTarget(id)
    areaStore.getState().setTool('draw')
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      const editingText =
        target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
      if (editingText && event.key !== 'Escape') return
      if (shortcutsOpen || replaceOpen || renumberOpen) return

      const state = areaStore.getState()
      if (shouldUseNativeDetailPaste(state.detailEditing != null, event)) return

      if (event.key === 'Escape' && holeTarget) {
        setHoleTarget(null)
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

      if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
        return
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault()
        state.redo()
        return
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
        event.preventDefault()
        copyContextual()
        return
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) {
        event.preventDefault()
        paste()
        return
      }

      if (event.key === 'D' || event.key === 'd') state.setTool('draw')
      else if (event.key === 'E' || event.key === 'e') state.setTool('edit')
      else if (event.key === 'P' || event.key === 'p') state.setTool('pan')
      else if (event.key === 'F' || event.key === 'f') state.setDrawKind('facility')
      else if (event.key === 'S' || event.key === 's') state.setDrawKind('store')
      else if (event.key === 'T' || event.key === 't') state.setTagsVisible(!state.tagsVisible)
      else if (event.key === '[') state.setActivePage(state.activePageIndex - 1)
      else if (event.key === ']') state.setActivePage(state.activePageIndex + 1)
      else if (event.key === '+' || event.key === '=') state.setZoom(state.zoom * 1.2)
      else if (event.key === '-') state.setZoom(state.zoom / 1.2)
      else if (event.key === '0') {
        state.setZoom(1)
        state.setPan({ x: 0, y: 0 })
      } else if (event.key === 'Delete' && state.selectedAreaIds.length)
        requestDeleteAreas(state.selectedAreaIds)
      else if (event.key === 'Escape') {
        if (state.tool === 'edit') state.setTool('draw')
        else if (state.selectedAreaIds.length) state.selectArea(null)
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
  }, [
    shortcutsOpen,
    replaceOpen,
    renumberOpen,
    holeTarget,
    copyContextual,
    paste,
    requestDeleteAreas
  ])

  return (
    <div className="app-shell">
      <Toolbar
        onOpenPdf={openPdf}
        onSaveProject={saveProject}
        onOpenProject={openProject}
        onGenerateReport={generateReport}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onToggleInspector={() => setInspectorOpen((open) => !open)}
        onUndo={() => areaStore.getState().undo()}
        onRedo={() => areaStore.getState().redo()}
        canUndo={canUndo}
        canRedo={canRedo}
        busy={busy}
      />
      <div className="workspace">
        <Sidebar onCopyAll={copyAll} onPaste={paste} />
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
          loading={busy === 'open-pdf' || busy === 'open-project'}
          onOpenPdf={openPdf}
          holeTarget={holeTarget}
          onHoleComplete={() => setHoleTarget(null)}
        />
        <InspectorPanel
          calibrationDraft={calibrationDraft}
          onClearCalibration={() => setCalibrationDraft([])}
          onCopyArea={copySelected}
          onRequestDeleteArea={(id) => requestDeleteAreas([id])}
          onRenumberStores={() => setRenumberOpen(true)}
          onAddHole={startHole}
          drawerOpen={inspectorOpen}
          hidden={narrow && !inspectorOpen}
        />
        {narrow ? (
          <div
            className={inspectorOpen ? 'drawer-backdrop is-open' : 'drawer-backdrop'}
            onClick={() => setInspectorOpen(false)}
          />
        ) : null}
      </div>

      <ModalDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        labelledBy="shortcuts-title"
      >
        <h2 id="shortcuts-title" className="modal__title">
          {tt('shortcuts.title')}
        </h2>
        <table className="shortcuts-table">
          <tbody>
            {shortcutRows.map(([key, action]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>{tt(action)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={() => setShortcutsOpen(false)}>
            {tt('action.close')}
          </button>
        </div>
      </ModalDialog>

      <ModalDialog
        open={replaceOpen}
        onClose={() => replaceResolver.current?.('cancel')}
        labelledBy="replace-title"
      >
        <h2 id="replace-title" className="modal__title">
          {tt('dialog.unsaved.title')}
        </h2>
        <p className="modal__text">{tt('dialog.unsaved.body')}</p>
        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => replaceResolver.current?.('cancel')}
          >
            {tt('dialog.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => replaceResolver.current?.('discard')}
          >
            {tt('dialog.unsaved.discard')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => replaceResolver.current?.('save')}
          >
            {tt('dialog.unsaved.save')}
          </button>
        </div>
      </ModalDialog>

      <ModalDialog
        open={renumberOpen}
        onClose={() => setRenumberOpen(false)}
        labelledBy="renumber-title"
      >
        <h2 id="renumber-title" className="modal__title">
          {tt('dialog.renumber.title')}
        </h2>
        <p className="modal__text">{tt('dialog.renumber.body')}</p>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={() => setRenumberOpen(false)}>
            {tt('dialog.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              const n = areaStore.getState().renumberStores()
              setRenumberOpen(false)
              showToast(n > 0 ? t('toast.renumbered', { n }) : t('toast.renumberNone'))
            }}
          >
            {tt('dialog.renumber.confirm')}
          </button>
        </div>
      </ModalDialog>

      {toast ? (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.action ? (
            <button type="button" className="toast__action" onClick={toast.action.run}>
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="sr-only" aria-live="polite">
        {fileName
          ? tt('sr.summary', {
              name: fileName,
              pages: pages.length,
              areas: areas.length,
              names: names.length
            })
          : tt('sr.noPdf')}
      </div>
    </div>
  )
}

export default App
