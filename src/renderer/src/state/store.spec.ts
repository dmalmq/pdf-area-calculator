import { describe, expect, it } from 'vitest'

import { aggregate, colorForBusiness, createAreaStore } from './store'
import type { Area, PageState } from './types'

const pages: PageState[] = [
  { pageIndex: 0, label: 'Page 1', scale: { kind: 'custom', mmPerPt: 10 } },
  { pageIndex: 1, label: 'Page 2', scale: null }
]

const square = (pageIndex: number, name: string): Area => ({
  id: crypto.randomUUID(),
  pageIndex,
  name,
  polygon: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ]
})

describe('area store', () => {
  it('deduplicates trimmed business names and activates them', () => {
    const store = createAreaStore()

    store.getState().addName(' エスパル仙台本館 ')
    store.getState().addName('エスパル仙台本館')
    store.getState().setActiveName(' JR仙台駅 ')

    expect(store.getState().names).toEqual(['エスパル仙台本館', 'JR仙台駅'])
    expect(store.getState().activeName).toBe('JR仙台駅')
  })

  it('keeps vertex edits valid and refuses to remove the third vertex', () => {
    const store = createAreaStore({ pages, areas: [square(0, 'A')], selectedAreaId: null })
    const areaId = store.getState().areas[0].id

    store.getState().moveVertex(areaId, 0, { x: 1, y: 2 })
    store.getState().insertVertex(areaId, 1, { x: 5, y: 0 })

    expect(store.getState().areas[0].polygon).toHaveLength(5)
    expect(store.getState().areas[0].polygon[0]).toEqual({ x: 1, y: 2 })
    expect(store.getState().removeVertex(areaId, 1)).toBe(true)
    expect(store.getState().removeVertex(areaId, 0)).toBe(true)
    expect(store.getState().removeVertex(areaId, 0)).toBe(false)
    expect(store.getState().areas[0].polygon).toHaveLength(3)
  })

  it('aggregates scaled square metres and unscaled square points by exact name', () => {
    const store = createAreaStore({
      pages,
      names: ['B', 'A', 'Unscaled'],
      areas: [square(0, 'B'), square(0, 'A'), square(0, 'B'), square(1, 'Unscaled')]
    })

    expect(aggregate(store.getState())).toEqual([
      { name: 'B', scaledM2: 0.02, unscaledPt2: 0, count: 2 },
      { name: 'A', scaledM2: 0.01, unscaledPt2: 0, count: 1 },
      { name: 'Unscaled', scaledM2: 0, unscaledPt2: 100, count: 1 }
    ])
  })

  it('reassigns areas, updates names, and clears selected deleted areas', () => {
    const area = square(0, 'A')
    const store = createAreaStore({ pages, names: ['A'], areas: [area], selectedAreaId: area.id })

    store.getState().renameArea(area.id, ' B ')
    expect(store.getState().areas[0].name).toBe('B')
    expect(store.getState().names).toEqual(['A', 'B'])

    store.getState().deleteArea(area.id)
    expect(store.getState().areas).toEqual([])
    expect(store.getState().selectedAreaId).toBeNull()
  })

  it('imports explicit project state without original PDF bytes', () => {
    const area = square(0, 'A')
    const store = createAreaStore({ fileName: 'source.pdf', pages: [], names: [], areas: [] })

    store.getState().importProject({ fileName: 'project.pdf', pages, names: ['A'], areas: [area] })

    expect(store.getState().fileName).toBe('project.pdf')
    expect(store.getState().pages).toEqual(pages)
    expect(store.getState().areas).toEqual([area])
    expect(store.getState().names).toEqual(['A'])
    expect(store.getState().originalBytes).toBeNull()
  })

  it('assigns and persists editable business colors', () => {
    const area = square(0, 'A')
    const store = createAreaStore({ pages, names: ['A'], areas: [area] })

    expect(colorForBusiness(store.getState(), 'A')).toMatch(/^#[0-9a-f]{6}$/i)

    store.getState().setNameColor('A', '#123456')
    expect(colorForBusiness(store.getState(), 'A')).toBe('#123456')

    store.getState().importProject({
      fileName: 'project.pdf',
      pages,
      names: ['A'],
      areas: [area],
      colors: { A: '#abcdef' }
    })
    expect(colorForBusiness(store.getState(), 'A')).toBe('#abcdef')
  })

  it('carries pdfPath through project import so the app can auto-open the source', () => {
    const area = square(0, 'A')
    const store = createAreaStore({ fileName: 'source.pdf', pages, names: [], areas: [] })

    store.getState().importProject({
      fileName: 'project.pdf',
      pages,
      names: ['A'],
      areas: [area],
      colors: {},
      pdfPath: 'C:/Documents/sample.pdf'
    })

    expect(store.getState().pdfPath).toBe('C:/Documents/sample.pdf')
  })
})
