import { useRef } from 'react'
import { useStore } from 'zustand'

import { localeStore, useT } from '../i18n'
import { selectIsDirty, useAreaStore } from '../state/store'
import type { BusyAction, Tool } from '../state/types'

interface ToolbarProps {
  onOpenPdf: () => void
  onSaveProject: () => void
  onOpenProject: () => void
  onGenerateReport: () => void
  onShowShortcuts: () => void
  onToggleInspector: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  busy: BusyAction | null
}

const tools: Tool[] = ['draw', 'edit', 'pan']

export function Toolbar({
  onOpenPdf,
  onSaveProject,
  onOpenProject,
  onGenerateReport,
  onShowShortcuts,
  onToggleInspector,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  busy
}: ToolbarProps): React.JSX.Element {
  const t = useT()
  const locale = useStore(localeStore, (s) => s.locale)
  const setLocale = useStore(localeStore, (s) => s.setLocale)
  const menuRef = useRef<HTMLDetailsElement>(null)

  const fileName = useAreaStore((s) => s.fileName)
  const dirty = useAreaStore(selectIsDirty)
  const pageIndex = useAreaStore((s) => s.activePageIndex)
  const pageCount = useAreaStore((s) => s.pages.length)
  const pageLabel = useAreaStore((s) => s.pages[s.activePageIndex]?.label ?? '')
  const tool = useAreaStore((s) => s.tool)
  const drawKind = useAreaStore((s) => s.drawKind)
  const areaCount = useAreaStore((s) => s.areas.length)
  const setActivePage = useAreaStore((s) => s.setActivePage)
  const setTool = useAreaStore((s) => s.setTool)
  const setDrawKind = useAreaStore((s) => s.setDrawKind)
  const tagsVisible = useAreaStore((s) => s.tagsVisible)
  const setTagsVisible = useAreaStore((s) => s.setTagsVisible)

  const runFromMenu = (action: () => void): void => {
    if (menuRef.current) menuRef.current.open = false
    action()
  }

  const generating = busy === 'generate-report'

  return (
    <header className="topbar">
      <div className="topbar__group">
        <span className="topbar__brand" aria-hidden="true">
          面
        </span>
        <div className="topbar__doc">
          <strong>{fileName ?? t('app.title')}</strong>
          {fileName ? (
            <small className={dirty ? 'is-dirty' : undefined}>
              {dirty ? t('status.unsaved') : t('status.saved')}
            </small>
          ) : null}
        </div>
      </div>

      <div className="topbar__group">
        <details className="menu" ref={menuRef}>
          <summary>{t('file.menu')}</summary>
          <div className="menu__list">
            <button
              type="button"
              className="btn"
              disabled={busy === 'open-pdf'}
              onClick={() => runFromMenu(onOpenPdf)}
            >
              {t('file.openPdf')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy === 'open-project'}
              onClick={() => runFromMenu(onOpenProject)}
            >
              {t('file.openProject')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy === 'save-project' || !fileName}
              onClick={() => runFromMenu(onSaveProject)}
            >
              {t('file.saveProject')}
            </button>
          </div>
        </details>
      </div>

      <div className="topbar__group topbar__page">
        <button
          type="button"
          className="btn btn--icon"
          aria-label={t('page.prev')}
          disabled={pageIndex <= 0}
          onClick={() => setActivePage(pageIndex - 1)}
        >
          ‹
        </button>
        <span className="muted">
          {pageCount ? `${pageLabel} · ${pageIndex + 1}/${pageCount}` : t('page.none')}
        </span>
        <button
          type="button"
          className="btn btn--icon"
          aria-label={t('page.next')}
          disabled={!pageCount || pageIndex >= pageCount - 1}
          onClick={() => setActivePage(pageIndex + 1)}
        >
          ›
        </button>
      </div>

      <div className="topbar__group">
        <button
          type="button"
          className="btn btn--icon"
          aria-label={t('action.undo')}
          title={t('action.undo')}
          disabled={!canUndo}
          onClick={onUndo}
        >
          ↶
        </button>
        <button
          type="button"
          className="btn btn--icon"
          aria-label={t('action.redo')}
          title={t('action.redo')}
          disabled={!canRedo}
          onClick={onRedo}
        >
          ↷
        </button>
      </div>

      <div className="topbar__group">
        <div
          className="segmented"
          role="group"
          aria-label={`${t('tool.draw')} / ${t('tool.edit')} / ${t('tool.pan')}`}
        >
          {tools.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="segmented__option"
              aria-pressed={tool === candidate}
              onClick={() => setTool(candidate)}
            >
              {t(`tool.${candidate}`)}
            </button>
          ))}
        </div>
      </div>

      {tool === 'draw' ? (
        <div className="topbar__group">
          <div
            className="segmented"
            role="group"
            aria-label={`${t('kind.facility')} / ${t('kind.store')}`}
          >
            <button
              type="button"
              className="segmented__option"
              aria-pressed={drawKind === 'facility'}
              onClick={() => setDrawKind('facility')}
            >
              {t('kind.facility')}
            </button>
            <button
              type="button"
              className="segmented__option"
              aria-pressed={drawKind === 'store'}
              onClick={() => setDrawKind('store')}
            >
              {t('kind.store')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="topbar__group topbar__group--end">
        <div className="segmented" role="group" aria-label={t('lang.label')}>
          <button
            type="button"
            className="segmented__option"
            aria-pressed={locale === 'ja'}
            onClick={() => setLocale('ja')}
          >
            {t('lang.ja')}
          </button>
          <button
            type="button"
            className="segmented__option"
            aria-pressed={locale === 'en'}
            onClick={() => setLocale('en')}
          >
            {t('lang.en')}
          </button>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={areaCount < 1 || generating}
          onClick={onGenerateReport}
        >
          {generating ? t('action.generating') : t('action.generateReport')}
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={tagsVisible}
          onClick={() => setTagsVisible(!tagsVisible)}
        >
          {t('action.tags')}
        </button>
        <button type="button" className="btn" onClick={onShowShortcuts}>
          {t('action.help')}
        </button>
        <button type="button" className="btn topbar__drawer-toggle" onClick={onToggleInspector}>
          {t('action.inspector')}
        </button>
      </div>
    </header>
  )
}
