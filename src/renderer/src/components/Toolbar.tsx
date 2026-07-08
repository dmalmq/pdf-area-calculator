import { useAreaStore } from '../state/store'
import type { Tool } from '../state/types'

interface ToolbarProps {
  onOpenPdf: () => void
  onSaveProject: () => void
  onOpenProject: () => void
  onGenerateReport: () => void
  onShowShortcuts: () => void
}

const tools: Tool[] = ['draw', 'edit', 'pan']

function toolLabel(tool: Tool): string {
  if (tool === 'draw') return 'Draw'
  if (tool === 'edit') return 'Edit'
  return 'Pan'
}

export function Toolbar({
  onOpenPdf,
  onSaveProject,
  onOpenProject,
  onGenerateReport,
  onShowShortcuts
}: ToolbarProps): React.JSX.Element {
  const pageIndex = useAreaStore((s) => s.activePageIndex)
  const pageCount = useAreaStore((s) => s.pages.length)
  const tool = useAreaStore((s) => s.tool)
  const zoom = useAreaStore((s) => s.zoom)
  const areaCount = useAreaStore((s) => s.areas.length)
  const setActivePage = useAreaStore((s) => s.setActivePage)
  const setTool = useAreaStore((s) => s.setTool)
  const setZoom = useAreaStore((s) => s.setZoom)
  const setPan = useAreaStore((s) => s.setPan)

  return (
    <header className="toolbar">
      <div className="toolbar__group">
        <button type="button" onClick={onOpenPdf}>Open</button>
        <button type="button" onClick={onSaveProject}>Save Project</button>
        <button type="button" onClick={onOpenProject}>Open Project</button>
      </div>

      <div className="toolbar__group">
        <button type="button" disabled={pageIndex <= 0} onClick={() => setActivePage(pageIndex - 1)}>
          Prev
        </button>
        <span className="toolbar__label">
          Page {pageCount ? pageIndex + 1 : 0}/{pageCount}
        </span>
        <button
          type="button"
          disabled={!pageCount || pageIndex >= pageCount - 1}
          onClick={() => setActivePage(pageIndex + 1)}
        >
          Next
        </button>
      </div>

      <div className="toolbar__group" aria-label="Tools">
        {tools.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={tool === candidate ? 'is-active' : ''}
            onClick={() => setTool(candidate)}
          >
            {toolLabel(candidate)}
          </button>
        ))}
      </div>

      <div className="toolbar__group">
        <button type="button" onClick={() => setZoom(zoom / 1.2)}>Zoom Out</button>
        <span className="toolbar__label">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(zoom * 1.2)}>Zoom In</button>
        <button
          type="button"
          onClick={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
          }}
        >
          Fit
        </button>
      </div>

      <div className="toolbar__group toolbar__group--end">
        <button type="button" disabled={areaCount < 1} onClick={onGenerateReport}>
          Generate Report
        </button>
        <button type="button" onClick={onShowShortcuts}>Shortcuts (?)</button>
      </div>
    </header>
  )
}
