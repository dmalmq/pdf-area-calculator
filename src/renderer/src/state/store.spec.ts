import { describe, expect, it } from 'vitest'

import { aggregate, colorForBusiness, createAreaStore, nextStoreCode } from './store'
import type { Area, PageState } from './types'

const pages: PageState[] = [
  { pageIndex: 0, label: 'Page 1', scale: { kind: 'custom', mmPerPt: 10 } },
  { pageIndex: 1, label: 'Page 2', scale: null }
]

const square = (pageIndex: number, name: string): Area => ({
  id: crypto.randomUUID(),
  pageIndex,
  kind: 'facility',
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

  it('copies the selected area and nothing when no selection', () => {
    const a = square(0, 'A')
    const store = createAreaStore({ pages, names: ['A'], areas: [a], selectedAreaId: a.id })

    expect(store.getState().copySelectedArea()).toBe(1)
    expect(store.getState().clipboard).toEqual([{ kind: 'facility', name: 'A', polygon: a.polygon }])

    store.getState().selectArea(null)
    expect(store.getState().copySelectedArea()).toBe(0)
  })

  it('copies every area on the active page', () => {
    const store = createAreaStore({
      pages,
      names: ['A', 'B'],
      areas: [square(0, 'A'), square(1, 'B'), square(0, 'A')],
      activePageIndex: 0
    })

    expect(store.getState().copyActivePage()).toBe(2)
    expect(store.getState().clipboard.map((c) => c.name)).toEqual(['A', 'A'])

    store.getState().setActivePage(1)
    // page 1 has one area 'B'
    expect(store.getState().copyActivePage()).toBe(1)
  })

  it('pastes clipboard areas onto the active page with fresh ids and selection', () => {
    const a = square(0, 'A')
    const store = createAreaStore({ pages, names: ['A'], areas: [a], selectedAreaId: a.id })
    store.getState().copySelectedArea()

    store.getState().setActivePage(1)
    expect(store.getState().pasteClipboard()).toBe(1)

    const pasted = store.getState().areas.find((area) => area.pageIndex === 1 && area.name === 'A')
    expect(pasted).toBeTruthy()
    expect(pasted!.id).not.toBe(a.id)
    expect(pasted!.polygon).toEqual(a.polygon)
    expect(store.getState().selectedAreaId).toBe(pasted!.id)

    // pasted polygon is an independent clone
    store.getState().setAreaPolygon(pasted!.id, [{ x: 99, y: 99 }, { x: 1, y: 0 }, { x: 0, y: 1 }])
    expect(store.getState().clipboard[0].polygon).toEqual(a.polygon)
    expect(store.getState().areas.find((area) => area.id === a.id)!.polygon).toEqual(a.polygon)
  })

  it('registers pasted names and returns 0 on empty clipboard', () => {
    const store = createAreaStore({ pages, names: [], areas: [], activePageIndex: 0 })
    expect(store.getState().pasteClipboard()).toBe(0)

    store.getState().importProject({ pages, names: ['X'], areas: [square(0, 'X')] })
    store.getState().copyActivePage()
    store.getState().pasteClipboard()
    expect(store.getState().names).toContain('X')
    expect(colorForBusiness(store.getState(), 'X')).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('setAreaPolygon replaces the target polygon and ignores unknown ids', () => {
    const a = square(0, 'A')
    const store = createAreaStore({ pages, names: ['A'], areas: [a] })
    const next = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]

    store.getState().setAreaPolygon(a.id, next)
    expect(store.getState().areas[0].polygon).toEqual(next)

    store.getState().setAreaPolygon('missing', [{ x: 0, y: 0 }])
    expect(store.getState().areas[0].polygon).toEqual(next)
  })

  it('generates the next store code from the facility prefix', () => {
    const store = createAreaStore({ pages, names: ['A'], prefixes: { A: 'ts' }, areas: [] })
    expect(nextStoreCode(store.getState(), 'A')).toBe('ts001')

    store.setState({
      areas: [
        { id: '1', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [] },
        { id: '2', pageIndex: 0, kind: 'store', name: 'A', code: 'ts004', polygon: [] },
        { id: '3', pageIndex: 0, kind: 'store', name: 'A', code: 'ts002A', polygon: [] }
      ]
    })
    // max ordinal is 4 (from ts004)
    expect(nextStoreCode(store.getState(), 'A')).toBe('ts005')
  })

  it('counts a suffixed code by its number, ignoring the suffix', () => {
    const store = createAreaStore({
      pages,
      names: ['A'],
      prefixes: { A: 'ts' },
      areas: [{ id: '1', pageIndex: 0, kind: 'store', name: 'A', code: 'ts002A', polygon: [] }]
    })
    // ts002A must count as ordinal 2, so the next code is ts003 (not a colliding ts001)
    expect(nextStoreCode(store.getState(), 'A')).toBe('ts003')
  })

  it('uses an empty prefix as just the padded number', () => {
    const store = createAreaStore({ pages, names: ['A'], prefixes: {}, areas: [] })
    expect(nextStoreCode(store.getState(), 'A')).toBe('001')
  })

  it('sets facility prefix, store code, and draw kind', () => {
    const area: Area = { id: 's1', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [] }
    const store = createAreaStore({ pages, names: ['A'], areas: [area] })

    store.getState().setFacilityPrefix('A', ' ts ')
    expect(store.getState().prefixes.A).toBe('ts')

    store.getState().setStoreCode('s1', ' ts009 ')
    expect(store.getState().areas[0].code).toBe('ts009')

    store.getState().setDrawKind('store')
    expect(store.getState().drawKind).toBe('store')
  })

  it('setStoreCode is a no-op on a facility area or unknown id', () => {
    const facility: Area = { id: 'f1', pageIndex: 0, kind: 'facility', name: 'A', polygon: [] }
    const store = createAreaStore({ pages, names: ['A'], areas: [facility] })

    store.getState().setStoreCode('f1', 'ts001') // facility → ignored
    expect(store.getState().areas[0].code).toBeUndefined()

    store.getState().setStoreCode('missing', 'ts001') // unknown id → no throw, no change
    expect(store.getState().areas[0].code).toBeUndefined()
  })
})
