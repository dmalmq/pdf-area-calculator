import { describe, expect, it } from 'vitest'

import {
  aggregate,
  colorForBusiness,
  createAreaStore,
  nextStoreCode,
  reportByFacility,
  reportByFacilityLevel,
  reportByLevel
} from './store'
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

  it('re-codes pasted stores and keeps pasted facility names', () => {
    const store = createAreaStore({
      pages,
      names: ['A'],
      prefixes: { A: 'ts' },
      areas: [
        { id: 'f', pageIndex: 0, kind: 'facility', name: 'A', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
        { id: 's', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }
      ]
    })
    // copy the store, paste it — it must get a fresh code, not ts001 again
    store.getState().selectArea('s')
    store.getState().copySelectedArea()
    store.getState().pasteClipboard()
    const codes = store.getState().areas.filter((a) => a.kind === 'store').map((a) => a.code)
    expect(codes).toEqual(['ts001', 'ts002'])
  })

  it('gives sequential codes to multiple stores pasted in one operation', () => {
    const store = createAreaStore({
      pages,
      names: ['A'],
      prefixes: { A: 'ts' },
      activePageIndex: 0,
      areas: [
        { id: 's1', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
        { id: 's2', pageIndex: 0, kind: 'store', name: 'A', code: 'ts002', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }
      ]
    })
    // copy the whole page (both stores), then paste — the two new stores must
    // advance sequentially past the existing ones AND past each other.
    store.getState().copyActivePage()
    store.getState().pasteClipboard()
    const codes = store.getState().areas.filter((a) => a.kind === 'store').map((a) => a.code)
    expect(codes).toEqual(['ts001', 'ts002', 'ts003', 'ts004'])
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

  it('migrates a v1 project: areas without kind become facilities, defaults applied', () => {
    const store = createAreaStore({})
    store.getState().importProject({
      fileName: 'p.pdf',
      pages,
      names: ['A'],
      areas: [{ id: 'a1', pageIndex: 0, name: 'A', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }]
    })
    expect(store.getState().areas[0].kind).toBe('facility')
    expect(store.getState().prefixes).toEqual({})
    expect(store.getState().legendPos).toBeNull()
    expect(store.getState().legendVisible).toBe(true)
  })

  it('imports v2 project fields verbatim', () => {
    const store = createAreaStore({})
    store.getState().importProject({
      fileName: 'p.pdf',
      pages,
      names: ['A'],
      areas: [{ id: 's', pageIndex: 0, kind: 'store', name: 'A', code: 'ts001', polygon: [] }],
      prefixes: { A: 'ts' },
      legendPos: { x: 20, y: 800 },
      legendVisible: false
    })
    expect(store.getState().areas[0].kind).toBe('store')
    expect(store.getState().prefixes).toEqual({ A: 'ts' })
    expect(store.getState().legendPos).toEqual({ x: 20, y: 800 })
    expect(store.getState().legendVisible).toBe(false)
  })

  it('reports by level, facility and facility-level (stores counted, only facilities measured)', () => {
    const store = createAreaStore({
      pages: [
        { pageIndex: 0, label: '1F', scale: { kind: 'custom', mmPerPt: 10 } },
        { pageIndex: 1, label: 'B1F', scale: { kind: 'custom', mmPerPt: 10 } }
      ],
      names: ['Tekute', 'Other'],
      areas: [
        square(0, 'Tekute'), // facility on 1F, 10x10 pt @10mm/pt = 0.01 m²
        square(1, 'Tekute'), // facility on B1F
        square(0, 'Other'), // facility on 1F
        { id: 's1', pageIndex: 0, kind: 'store', name: 'Tekute', code: 'ts001', polygon: [] },
        { id: 's2', pageIndex: 0, kind: 'store', name: 'Tekute', code: 'ts002', polygon: [] },
        { id: 's3', pageIndex: 1, kind: 'store', name: 'Tekute', code: 'ts003', polygon: [] }
      ]
    })

    const byLevel = reportByLevel(store.getState())
    expect(byLevel.map((r) => r.level)).toEqual(['1F', 'B1F']) // page order
    const oneF = byLevel.find((r) => r.level === '1F')!
    expect(oneF.stores).toBe(2)
    expect(oneF.facilities).toBe(2) // Tekute + Other
    expect(oneF.areaM2).toBeCloseTo(0.02) // two facility squares

    const byFac = reportByFacility(store.getState())
    const tekute = byFac.find((r) => r.name === 'Tekute')!
    expect(tekute.stores).toBe(3)
    expect(tekute.levels).toEqual(['1F', 'B1F'])
    expect(tekute.areaM2).toBeCloseTo(0.02)

    const byFacLevel = reportByFacilityLevel(store.getState())
    const tekuteB1 = byFacLevel.find((r) => r.name === 'Tekute' && r.level === 'B1F')!
    expect(tekuteB1.stores).toBe(1)
    expect(tekuteB1.areaM2).toBeCloseTo(0.01)
  })

  it('keeps facility×level rows distinct when name+level would collide as one string', () => {
    // "Food Court" + "B1"  vs  "Food" + "Court B1" both concatenate to
    // "Food Court B1" under a naive `${name} ${level}` key — they must stay separate.
    const store = createAreaStore({
      pages: [
        { pageIndex: 0, label: 'B1', scale: { kind: 'custom', mmPerPt: 10 } },
        { pageIndex: 1, label: 'Court B1', scale: { kind: 'custom', mmPerPt: 10 } }
      ],
      names: ['Food Court', 'Food'],
      areas: [square(0, 'Food Court'), square(1, 'Food')]
    })

    const rows = reportByFacilityLevel(store.getState())
    const a = rows.filter((r) => r.name === 'Food Court' && r.level === 'B1')
    const b = rows.filter((r) => r.name === 'Food' && r.level === 'Court B1')
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0].areaM2).toBeCloseTo(0.01)
    expect(b[0].areaM2).toBeCloseTo(0.01)
  })

  it('a facility present on a level only via a store does not inflate the level facility count', () => {
    const store = createAreaStore({
      pages: [{ pageIndex: 0, label: '1F', scale: { kind: 'custom', mmPerPt: 10 } }],
      names: ['A', 'B'],
      areas: [
        square(0, 'A'), // A has a facility polygon on 1F
        { id: 's', pageIndex: 0, kind: 'store', name: 'B', code: 'b001', polygon: [] } // B only a store on 1F
      ]
    })

    const oneF = reportByLevel(store.getState()).find((r) => r.level === '1F')!
    expect(oneF.facilities).toBe(1) // only A has a facility polygon; B's store must not count
    expect(oneF.stores).toBe(1)

    // B still gets a facility×level row from its store, with zero area
    const bRow = reportByFacilityLevel(store.getState()).find((r) => r.name === 'B' && r.level === '1F')!
    expect(bRow.stores).toBe(1)
    expect(bRow.areaM2).toBe(0)
  })

  it('reports unscaled facility area as unscaledPt2, not areaM2', () => {
    const store = createAreaStore({
      pages: [{ pageIndex: 0, label: '1F', scale: null }],
      names: ['A'],
      areas: [square(0, 'A')] // 10x10 = 100 pt² on an unscaled page
    })

    const oneF = reportByLevel(store.getState()).find((r) => r.level === '1F')!
    expect(oneF.areaM2).toBe(0)
    expect(oneF.unscaledPt2).toBeCloseTo(100)

    const aFac = reportByFacility(store.getState()).find((r) => r.name === 'A')!
    expect(aFac.areaM2).toBe(0)
    expect(aFac.unscaledPt2).toBeCloseTo(100)
  })
})
