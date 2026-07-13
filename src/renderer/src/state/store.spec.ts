import { describe, expect, it } from 'vitest'

import {
  aggregate,
  colorForBusiness,
  createAreaStore,
  detailCandidates,
  facilitiesOnPage,
  nextStoreCode,
  reportByFacility,
  reportByFacilityLevel,
  reportByLevel,
  renumberStoreCodes,
  selectIsDirty,
  toProjectFile
} from './store'
import type { Area, DetailPage, PageState } from './types'

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

const storeAt = (pageIndex: number, name: string, cx: number, cy: number, code?: string): Area => ({
  id: crypto.randomUUID(),
  pageIndex,
  kind: 'store',
  name,
  code,
  polygon: [
    { x: cx - 2, y: cy - 2 },
    { x: cx + 2, y: cy - 2 },
    { x: cx + 2, y: cy + 2 },
    { x: cx - 2, y: cy + 2 }
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
    expect(store.getState().clipboard).toEqual([
      { kind: 'facility', name: 'A', polygon: a.polygon }
    ])

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
    store.getState().setAreaPolygon(pasted!.id, [
      { x: 99, y: 99 },
      { x: 1, y: 0 },
      { x: 0, y: 1 }
    ])
    expect(store.getState().clipboard[0].polygon).toEqual(a.polygon)
    expect(store.getState().areas.find((area) => area.id === a.id)!.polygon).toEqual(a.polygon)
  })

  it('re-codes pasted stores and keeps pasted facility names', () => {
    const store = createAreaStore({
      pages,
      names: ['A'],
      prefixes: { A: 'ts' },
      areas: [
        {
          id: 'f',
          pageIndex: 0,
          kind: 'facility',
          name: 'A',
          polygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 }
          ]
        },
        {
          id: 's',
          pageIndex: 0,
          kind: 'store',
          name: 'A',
          code: 'ts001',
          polygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 }
          ]
        }
      ]
    })
    // copy the store, paste it — it must get a fresh code, not ts001 again
    store.getState().selectArea('s')
    store.getState().copySelectedArea()
    store.getState().pasteClipboard()
    const codes = store
      .getState()
      .areas.filter((a) => a.kind === 'store')
      .map((a) => a.code)
    expect(codes).toEqual(['ts001', 'ts002'])
  })

  it('gives sequential codes to multiple stores pasted in one operation', () => {
    const store = createAreaStore({
      pages,
      names: ['A'],
      prefixes: { A: 'ts' },
      activePageIndex: 0,
      areas: [
        {
          id: 's1',
          pageIndex: 0,
          kind: 'store',
          name: 'A',
          code: 'ts001',
          polygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 }
          ]
        },
        {
          id: 's2',
          pageIndex: 0,
          kind: 'store',
          name: 'A',
          code: 'ts002',
          polygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 }
          ]
        }
      ]
    })
    // copy the whole page (both stores), then paste — the two new stores must
    // advance sequentially past the existing ones AND past each other.
    store.getState().copyActivePage()
    store.getState().pasteClipboard()
    const codes = store
      .getState()
      .areas.filter((a) => a.kind === 'store')
      .map((a) => a.code)
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
    const next = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 }
    ]

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
    const area: Area = {
      id: 's1',
      pageIndex: 0,
      kind: 'store',
      name: 'A',
      code: 'ts001',
      polygon: []
    }
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
      areas: [
        {
          id: 'a1',
          pageIndex: 0,
          name: 'A',
          polygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 }
          ]
        }
      ]
    })
    expect(store.getState().areas[0].kind).toBe('facility')
    expect(store.getState().prefixes).toEqual({})
    expect(store.getState().legendPos).toBeNull()
    expect(store.getState().legendVisible).toBe(true)
    expect(store.getState().legendScale).toBe(1)
    expect(store.getState().legendOrientation).toBe('vertical')
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
      legendVisible: false,
      legendScale: 2,
      legendOrientation: 'horizontal'
    })
    expect(store.getState().areas[0].kind).toBe('store')
    expect(store.getState().prefixes).toEqual({ A: 'ts' })
    expect(store.getState().legendPos).toEqual({ x: 20, y: 800 })
    expect(store.getState().legendVisible).toBe(false)
    expect(store.getState().legendScale).toBe(2)
    expect(store.getState().legendOrientation).toBe('horizontal')
    store.getState().importProject({ pages, names: ['A'], areas: [], legendScale: 99 })
    expect(store.getState().legendScale).toBe(4)
    store.getState().importProject({ pages, names: ['A'], areas: [] })
    expect(store.getState().legendScale).toBe(1)
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
    const bRow = reportByFacilityLevel(store.getState()).find(
      (r) => r.name === 'B' && r.level === '1F'
    )!
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

  it('lists facilities on a page (any area) and legend state actions', () => {
    const store = createAreaStore({
      pages,
      names: ['A', 'B'],
      areas: [
        square(0, 'A'), // facility on page 0
        { id: 's', pageIndex: 0, kind: 'store', name: 'B', code: 'b001', polygon: [] } // only a store for B on page 0
      ]
    })
    const entries = facilitiesOnPage(store.getState(), 0)
    expect(entries.map((e) => e.name)).toEqual(['A', 'B'])
    expect(entries[0].color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(facilitiesOnPage(store.getState(), 1)).toEqual([])

    store.getState().setLegendPos({ x: 5, y: 9 })
    expect(store.getState().legendPos).toEqual({ x: 5, y: 9 })
    store.getState().setLegendVisible(false)
    expect(store.getState().legendVisible).toBe(false)
    store.getState().setLegendScale(2)
    expect(store.getState().legendScale).toBe(2)
    store.getState().setLegendScale(0.1)
    expect(store.getState().legendScale).toBe(0.5)
    store.getState().setLegendScale(99)
    expect(store.getState().legendScale).toBe(4)
    store.getState().setLegendOrientation('horizontal')
    expect(store.getState().legendOrientation).toBe('horizontal')
  })

  it('sets a per-area label offset without touching other areas', () => {
    const a = square(0, 'A')
    const b = square(0, 'B')
    const store = createAreaStore({ areas: [a, b] })

    store.getState().setAreaLabelOffset(a.id, { x: 5, y: -3 })

    expect(store.getState().areas.find((area) => area.id === a.id)?.labelOffset).toEqual({
      x: 5,
      y: -3
    })
    expect(store.getState().areas.find((area) => area.id === b.id)?.labelOffset).toBeUndefined()
  })

  it('defaults and sets the store label mode', () => {
    const store = createAreaStore({})
    expect(store.getState().storeLabelMode).toBe('code')
    store.getState().setStoreLabelMode('number')
    expect(store.getState().storeLabelMode).toBe('number')
  })

  it('preserves labelOffset and storeLabelMode through importProject, with defaults', () => {
    const store = createAreaStore({})
    store.getState().importProject({
      pages,
      names: ['A'],
      areas: [
        {
          id: 'a1',
          pageIndex: 0,
          kind: 'facility',
          name: 'A',
          polygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 }
          ],
          labelOffset: { x: 7, y: 8 }
        },
        {
          id: 'a2',
          pageIndex: 0,
          kind: 'facility',
          name: 'A',
          polygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 }
          ]
        }
      ],
      storeLabelMode: 'number'
    })
    expect(store.getState().areas[0].labelOffset).toEqual({ x: 7, y: 8 })
    expect(store.getState().areas[1].labelOffset).toBeUndefined()
    expect(store.getState().storeLabelMode).toBe('number')

    store.getState().importProject({ pages, names: ['A'], areas: [] })
    expect(store.getState().storeLabelMode).toBe('code')
  })

  it('toProjectFile round-trips a known persisted project slice', () => {
    const area = square(0, 'A')
    const store = createAreaStore({
      fileName: 'plan.pdf',
      pdfPath: 'C:/docs/plan.pdf',
      pages,
      areas: [area],
      names: ['A'],
      colors: { A: '#aabbcc' },
      prefixes: { A: 'ts' },
      legendPos: { x: 1, y: 2 },
      legendVisible: false,
      legendScale: 1.5,
      legendOrientation: 'horizontal',
      storeLabelMode: 'number'
    })

    expect(toProjectFile(store.getState())).toEqual({
      version: 3,
      fileName: 'plan.pdf',
      pdfPath: 'C:/docs/plan.pdf',
      pages,
      areas: [area],
      names: ['A'],
      colors: { A: '#aabbcc' },
      prefixes: { A: 'ts' },
      legendPos: { x: 1, y: 2 },
      legendVisible: false,
      legendScale: 1.5,
      legendOrientation: 'horizontal',
      storeLabelMode: 'number',
      detailPages: []
    })
  })

  it('selectIsDirty is false after import/mark, true after addArea, false for view-only actions', () => {
    const store = createAreaStore({ fileName: 'source.pdf', pages: [], names: [], areas: [] })
    expect(selectIsDirty(store.getState())).toBe(false)

    store.getState().importProject({ fileName: 'project.pdf', pages, names: ['A'], areas: [] })
    expect(selectIsDirty(store.getState())).toBe(false)

    const area = square(0, 'A')
    store.getState().addArea(area)
    expect(selectIsDirty(store.getState())).toBe(true)

    store.getState().setTool('edit')
    store.getState().setZoom(2)
    store.getState().selectArea(area.id)
    expect(selectIsDirty(store.getState())).toBe(true)
    expect(store.getState().tool).toBe('edit')
    expect(store.getState().zoom).toBe(2)
    expect(store.getState().selectedAreaId).toBe(area.id)

    store.getState().markProjectSaved()
    expect(selectIsDirty(store.getState())).toBe(false)

    store.getState().setTool('pan')
    store.getState().setZoom(1.5)
    store.getState().selectArea(null)
    expect(selectIsDirty(store.getState())).toBe(false)
  })

  it('deleteArea removes the target, clears selection, and no-ops for unknown ids', () => {
    const a = square(0, 'A')
    const b = square(0, 'B')
    const c = square(0, 'C')
    const store = createAreaStore({
      pages,
      names: ['A', 'B', 'C'],
      areas: [a, b, c],
      selectedAreaId: b.id
    })

    store.getState().deleteArea(b.id)
    expect(store.getState().areas).toEqual([a, c])
    expect(store.getState().selectedAreaId).toBeNull()

    store.getState().deleteArea('missing')
    expect(store.getState().areas).toEqual([a, c])
  })

  it('renumberStoreCodes orders stores per facility by page, then top-to-bottom, left-to-right', () => {
    const topLeft = storeAt(0, 'A', 10, 100, 'ts005')
    const topRight = storeAt(0, 'A', 100, 100, 'ts006')
    const bottom = storeAt(0, 'A', 50, 10, 'ts007')
    const assignments = renumberStoreCodes({
      areas: [bottom, topRight, topLeft],
      prefixes: { A: 'ts' }
    })
    const codeFor = (id: string): string | undefined => assignments.find((a) => a.id === id)?.code
    expect(codeFor(topLeft.id)).toBe('ts001')
    expect(codeFor(topRight.id)).toBe('ts002')
    expect(codeFor(bottom.id)).toBe('ts003')
  })

  it('renumberStoreCodes continues across pages and handles empty prefixes and multiple facilities', () => {
    const a0 = storeAt(0, 'A', 10, 50, 'x')
    const a1 = storeAt(1, 'A', 10, 50, 'y')
    const b0 = storeAt(0, 'B', 10, 50)
    const assignments = renumberStoreCodes({ areas: [a1, b0, a0], prefixes: { A: 'ts' } })
    const codeFor = (id: string): string | undefined => assignments.find((a) => a.id === id)?.code
    expect(codeFor(a0.id)).toBe('ts001')
    expect(codeFor(a1.id)).toBe('ts002')
    expect(codeFor(b0.id)).toBe('001')
  })

  it('renumberStoreCodes infers an unregistered prefix from existing codes and normalizes stragglers', () => {
    const top = storeAt(0, 'M', 10, 100, 'S本館003')
    const right = storeAt(0, 'M', 100, 100, 'S本館007')
    const straggler = storeAt(0, 'M', 50, 10, '012')
    const assignments = renumberStoreCodes({ areas: [top, right, straggler], prefixes: {} })
    const codeFor = (id: string): string | undefined => assignments.find((a) => a.id === id)?.code
    expect(codeFor(top.id)).toBe('S本館001')
    expect(codeFor(right.id)).toBe('S本館002')
    expect(codeFor(straggler.id)).toBe('S本館003')
  })

  it('renumberStores applies codes, ignores facilities, counts changes, and is idempotent', () => {
    const topLeft = storeAt(0, 'A', 10, 100, 'ts005')
    const topRight = storeAt(0, 'A', 100, 100, 'ts006')
    const bottom = storeAt(0, 'A', 50, 10, 'ts007')
    const facility = square(0, 'A')
    const store = createAreaStore({
      pages,
      names: ['A'],
      prefixes: { A: 'ts' },
      areas: [bottom, topRight, topLeft, facility]
    })
    expect(store.getState().renumberStores()).toBe(3)
    const codeFor = (id: string): string | undefined =>
      store.getState().areas.find((a) => a.id === id)?.code
    expect(codeFor(topLeft.id)).toBe('ts001')
    expect(codeFor(topRight.id)).toBe('ts002')
    expect(codeFor(bottom.id)).toBe('ts003')
    expect(codeFor(facility.id)).toBeUndefined()
    expect(store.getState().renumberStores()).toBe(0)
  })
})

describe('holes and net area', () => {
  const holeRing = [
    { x: 2, y: 2 },
    { x: 4, y: 2 },
    { x: 4, y: 4 },
    { x: 2, y: 4 }
  ]

  it('adds and removes whole holes on an area', () => {
    const store = createAreaStore({ areas: [square(0, 'A')] })
    const id = store.getState().areas[0].id
    store.getState().addHole(id, holeRing)
    expect(store.getState().areas[0].holes).toHaveLength(1)
    expect(store.getState().areas[0].holes![0]).not.toBe(holeRing)
    store.getState().removeHole(id, 0)
    expect(store.getState().areas[0].holes).toBeUndefined()
  })

  it('rejects a hole with fewer than three vertices', () => {
    const store = createAreaStore({ areas: [square(0, 'A')] })
    const id = store.getState().areas[0].id
    store.getState().addHole(id, [
      { x: 1, y: 1 },
      { x: 2, y: 2 }
    ])
    expect(store.getState().areas[0].holes).toBeUndefined()
  })

  it('subtracts hole area from the reported facility total', () => {
    const solid = aggregate({ areas: [square(0, 'A')], pages })[0]
    const holed = aggregate({ areas: [{ ...square(0, 'A'), holes: [holeRing] }], pages })[0]
    expect(solid.scaledM2).toBeCloseTo(0.01)
    expect(holed.scaledM2).toBeCloseTo(0.0096)
  })

  it('clones holes on import so edits do not alias the source', () => {
    const source = toProjectFile(
      createAreaStore({ areas: [{ ...square(0, 'A'), holes: [holeRing] }] }).getState()
    )
    const store = createAreaStore()
    store.getState().importProject(source)
    const imported = store.getState().areas[0]
    expect(imported.holes).toEqual([holeRing])
    expect(imported.holes![0]).not.toBe(source.areas[0].holes![0])
  })
})

describe('setAreaKind', () => {
  it('assigns a store code when converting facility to store', () => {
    const store = createAreaStore({ areas: [square(0, 'A')] })
    const id = store.getState().areas[0].id
    store.getState().setAreaKind(id, 'store')
    expect(store.getState().areas[0].kind).toBe('store')
    expect(store.getState().areas[0].code).toBe('001')
  })

  it('clears the code when converting store to facility', () => {
    const store = createAreaStore({ areas: [storeAt(0, 'A', 50, 50, 'ts001')] })
    const id = store.getState().areas[0].id
    store.getState().setAreaKind(id, 'facility')
    expect(store.getState().areas[0].kind).toBe('facility')
    expect(store.getState().areas[0].code).toBeUndefined()
  })
})

describe('undo and redo', () => {
  it('undoes and redoes a discrete edit', () => {
    const store = createAreaStore({ areas: [square(0, 'A')] })
    const id = store.getState().areas[0].id
    store.getState().renameArea(id, 'B')
    expect(store.getState().areas[0].name).toBe('B')
    store.getState().undo()
    expect(store.getState().areas[0].name).toBe('A')
    store.getState().redo()
    expect(store.getState().areas[0].name).toBe('B')
  })

  it('coalesces one interaction into a single undo step', () => {
    const store = createAreaStore({ areas: [square(0, 'A')] })
    const id = store.getState().areas[0].id
    store.getState().beginInteraction()
    store.getState().moveVertex(id, 0, { x: 5, y: 5 })
    store.getState().moveVertex(id, 0, { x: 6, y: 6 })
    store.getState().endInteraction()
    expect(store.getState().areas[0].polygon[0]).toEqual({ x: 6, y: 6 })
    expect(store.getState().undoStack).toHaveLength(1)
    store.getState().undo()
    expect(store.getState().areas[0].polygon[0]).toEqual({ x: 0, y: 0 })
    expect(store.getState().undoStack).toHaveLength(0)
  })

  it('clears history when a project is imported', () => {
    const store = createAreaStore({ areas: [square(0, 'A')] })
    const id = store.getState().areas[0].id
    store.getState().renameArea(id, 'B')
    expect(store.getState().undoStack.length).toBeGreaterThan(0)
    store.getState().importProject(toProjectFile(store.getState()))
    expect(store.getState().undoStack).toHaveLength(0)
    expect(store.getState().redoStack).toHaveLength(0)
  })
})

describe('tag visibility', () => {
  it('defaults on, toggles, and is excluded from the saved fingerprint', () => {
    const store = createAreaStore({ pages, names: ['A'], areas: [square(0, 'A')] })
    expect(store.getState().tagsVisible).toBe(true)
    const before = JSON.stringify(toProjectFile(store.getState()))
    store.getState().setTagsVisible(false)
    expect(store.getState().tagsVisible).toBe(false)
    // view-only: does not change the persisted project
    expect(JSON.stringify(toProjectFile(store.getState()))).toBe(before)
  })
})

describe('deletePage', () => {
  it('removes the page and its areas, keeps >=1, and is undoable', () => {
    const a = square(0, 'A')
    const b = square(1, 'B')
    const store = createAreaStore({ pages, names: ['A', 'B'], areas: [a, b], activePageIndex: 1 })

    store.getState().deletePage(1)
    expect(store.getState().pages.map((p) => p.pageIndex)).toEqual([0])
    expect(store.getState().areas).toEqual([a])
    expect(store.getState().activePageIndex).toBe(0)

    // cannot delete the final remaining page
    store.getState().deletePage(0)
    expect(store.getState().pages).toHaveLength(1)

    // undo restores page 1 and area b together
    store.getState().undo()
    expect(store.getState().pages.map((p) => p.pageIndex)).toEqual([0, 1])
    expect(store.getState().areas).toEqual([a, b])
  })
})

describe('movePage', () => {
  it('reorders pages, keeps the viewed page active, and is undoable', () => {
    const store = createAreaStore({ pages, names: [], areas: [], activePageIndex: 0 })

    store.getState().movePage(0, 1)
    expect(store.getState().pages.map((p) => p.pageIndex)).toEqual([1, 0])
    // still viewing source page 0, now at array position 1
    expect(store.getState().activePageIndex).toBe(1)

    store.getState().undo()
    expect(store.getState().pages.map((p) => p.pageIndex)).toEqual([0, 1])
  })
})

describe('viewed-source page cursor decoupling', () => {
  it('copyActivePage/pasteClipboard act on the viewed source page after reorder', () => {
    const a = square(1, 'A') // area on source page 1
    const store = createAreaStore({ pages, names: ['A'], areas: [a], activePageIndex: 1 })
    store.getState().movePage(1, 0) // pages -> [1,0]; cursor follows source 1 to index 0
    expect(store.getState().activePageIndex).toBe(0)
    expect(store.getState().copyActivePage()).toBe(1) // copies the area on the viewed source (page 1)
    store.getState().setActivePage(1) // now viewing source 0 (empty)
    const before = store.getState().areas.length
    store.getState().pasteClipboard()
    const pasted = store.getState().areas[store.getState().areas.length - 1]
    expect(store.getState().areas.length).toBe(before + 1)
    expect(pasted.pageIndex).toBe(0) // pasted onto the viewed source (page 0)
  })

  it('undo/redo keep activePageIndex valid and on the viewed page', () => {
    const store = createAreaStore({ pages, names: [], areas: [], activePageIndex: 0 })
    store.getState().movePage(0, 1) // [1,0], cursor 1 (viewing source 0)
    store.getState().undo() // pages back to [0,1]
    const s = store.getState()
    expect(s.activePageIndex).toBeGreaterThanOrEqual(0)
    expect(s.activePageIndex).toBeLessThan(s.pages.length)
    expect(s.pages[s.activePageIndex].pageIndex).toBe(0) // still viewing source 0
  })

  it('keeps the page cursor at 0 when undo restores an empty document', () => {
    const store = createAreaStore({ pages: [], names: [], areas: [], activePageIndex: 0 })
    store.getState().addName('X')
    store.getState().undo()
    expect(store.getState().activePageIndex).toBe(0)
  })
})

describe('report ordering', () => {
  it('orders levels by page display order, not by source index', () => {
    const twoPages = [
      { pageIndex: 0, label: '1F', scale: null },
      { pageIndex: 1, label: '2F', scale: null }
    ]
    const a0 = square(0, 'A')
    const a1 = square(1, 'B')
    expect(reportByLevel({ pages: twoPages, areas: [a0, a1] }).map((r) => r.level)).toEqual([
      '1F',
      '2F'
    ])
    const reordered = [twoPages[1], twoPages[0]]
    expect(reportByLevel({ pages: reordered, areas: [a0, a1] }).map((r) => r.level)).toEqual([
      '2F',
      '1F'
    ])
  })
})

describe('interaction history boundaries', () => {
  it('finalizes an open interaction before undo and ignores a late endInteraction', () => {
    const t0 = { x: 0, y: 0, scale: 1, rotation: 0 }
    const t1 = { x: 4, y: 5, scale: 2, rotation: 10 }
    const store = createAreaStore({
      detailPages: [{ name: 'A', pageIndex: 0, image: 'PNG', transform: t0 }]
    })

    store.getState().beginInteraction()
    store.getState().setDetailTransform('A', 0, t1)
    store.getState().undo()

    expect(store.getState().detailPages[0].transform).toEqual(t0)
    expect(store.getState().redoStack).toHaveLength(1)
    store.getState().endInteraction()
    expect(store.getState().detailPages[0].transform).toEqual(t0)
    expect(store.getState().redoStack).toHaveLength(1)

    store.getState().redo()
    expect(store.getState().detailPages[0].transform).toEqual(t1)
  })

  it('keeps the first snapshot when a gesture calls beginInteraction repeatedly', () => {
    const t0 = { x: 0, y: 0, scale: 1, rotation: 0 }
    const t1 = { x: 4, y: 5, scale: 2, rotation: 10 }
    const t2 = { x: 8, y: 9, scale: 3, rotation: 20 }
    const store = createAreaStore({
      detailPages: [{ name: 'A', pageIndex: 0, image: 'PNG', transform: t0 }]
    })
    store.getState().beginInteraction()
    store.getState().setDetailTransform('A', 0, t1)
    store.getState().beginInteraction()
    store.getState().setDetailTransform('A', 0, t2)
    store.getState().endInteraction()
    store.getState().undo()
    expect(store.getState().detailPages[0].transform).toEqual(t0)
  })
})

describe('detail pages persistence', () => {
  const detail: DetailPage = {
    name: 'A',
    pageIndex: 0,
    image: 'BASE64PNG',
    transform: { x: 12, y: 34, scale: 2, rotation: 15 }
  }

  it('serializes detailPages and version 3 in toProjectFile', () => {
    const store = createAreaStore({ detailPages: [detail] })
    const file = toProjectFile(store.getState())
    expect(file.version).toBe(3)
    expect(file.detailPages).toEqual([detail])
  })

  it('does not persist the transient detailEditing field', () => {
    const store = createAreaStore({ detailEditing: { name: 'A', pageIndex: 0 } })
    expect('detailEditing' in toProjectFile(store.getState())).toBe(false)
  })

  it('migrates a v2 project (no detailPages) to an empty array on import', () => {
    const store = createAreaStore({})
    store.getState().importProject({ pages, names: ['A'], areas: [] })
    expect(store.getState().detailPages).toEqual([])
  })

  it('imports detailPages verbatim and closes any open editor', () => {
    const store = createAreaStore({ detailEditing: { name: 'A', pageIndex: 0 } })
    store.getState().importProject({ pages, names: ['A'], areas: [], detailPages: [detail] })
    expect(store.getState().detailPages).toEqual([detail])
    expect(store.getState().detailEditing).toBeNull()
  })

  it('restores detailPages from an undo snapshot', () => {
    const snapshot = JSON.stringify(
      toProjectFile(createAreaStore({ detailPages: [detail] }).getState())
    )
    const store = createAreaStore({ detailPages: [], undoStack: [snapshot] })
    store.getState().undo()
    expect(store.getState().detailPages).toEqual([detail])
  })

  it('resets detailPages and detailEditing when a document is loaded', () => {
    const store = createAreaStore({
      detailPages: [detail],
      detailEditing: { name: 'A', pageIndex: 0 }
    })
    // loadDocument is async and needs a PDF; assert the reset fields are wired via importProject reset instead.
    store.getState().importProject({ pages, names: [], areas: [] })
    expect(store.getState().detailPages).toEqual([])
    expect(store.getState().detailEditing).toBeNull()
  })
})

describe('detailCandidates and enable/disable', () => {
  it('orders candidates by names order then page ascending, counting stores', () => {
    const store = createAreaStore({
      pages,
      names: ['B', 'A'],
      areas: [
        square(1, 'A'),
        square(0, 'A'),
        storeAt(0, 'A', 3, 3),
        storeAt(0, 'A', 6, 6),
        square(0, 'B')
      ]
    })

    expect(detailCandidates(store.getState())).toEqual([
      { name: 'B', pageIndex: 0, level: 'Page 1', stores: 0 },
      { name: 'A', pageIndex: 0, level: 'Page 1', stores: 2 },
      { name: 'A', pageIndex: 1, level: 'Page 2', stores: 0 }
    ])
  })

  it('lists a store-only combo as a candidate', () => {
    const store = createAreaStore({
      pages,
      names: ['A'],
      areas: [storeAt(1, 'A', 5, 5)]
    })
    expect(detailCandidates(store.getState())).toEqual([
      { name: 'A', pageIndex: 1, level: 'Page 2', stores: 1 }
    ])
  })

  it('enables a combo by appending a DetailPage and is idempotent', () => {
    const store = createAreaStore({ pages, names: ['A'], areas: [square(0, 'A')] })
    store.getState().setDetailPageEnabled('A', 0, true)
    store.getState().setDetailPageEnabled('A', 0, true)
    expect(store.getState().detailPages).toEqual([{ name: 'A', pageIndex: 0 }])
  })

  it('disabling removes the entry and its image', () => {
    const store = createAreaStore({
      detailPages: [
        { name: 'A', pageIndex: 0, image: 'PNG', transform: { x: 0, y: 0, scale: 1, rotation: 0 } }
      ]
    })
    store.getState().setDetailPageEnabled('A', 0, false)
    expect(store.getState().detailPages).toEqual([])
  })

  it('records enable on the undo stack and undo reverts it', () => {
    const store = createAreaStore({ pages, names: ['A'], areas: [square(0, 'A')] })
    store.getState().setDetailPageEnabled('A', 0, true)
    expect(store.getState().detailPages).toEqual([{ name: 'A', pageIndex: 0 }])
    expect(store.getState().undoStack.length).toBeGreaterThan(0)
    store.getState().undo()
    expect(store.getState().detailPages).toEqual([])
  })

  it('prunes a DetailPage when the last polygon of its combo is deleted', () => {
    const facility = square(0, 'A')
    const store = createAreaStore({
      pages,
      names: ['A'],
      areas: [facility],
      detailPages: [{ name: 'A', pageIndex: 0, image: 'PNG' }]
    })
    store.getState().deleteArea(facility.id)
    expect(store.getState().detailPages).toEqual([])
  })

  it('keeps a DetailPage while any polygon of its combo remains', () => {
    const facility = square(0, 'A')
    const other = storeAt(0, 'A', 5, 5)
    const store = createAreaStore({
      pages,
      names: ['A'],
      areas: [facility, other],
      detailPages: [{ name: 'A', pageIndex: 0 }]
    })
    store.getState().deleteArea(facility.id)
    expect(store.getState().detailPages).toEqual([{ name: 'A', pageIndex: 0 }])
  })

  it('prunes a DetailPage when the last polygon of its combo is renamed away', () => {
    const facility = square(0, 'A')
    const store = createAreaStore({
      pages,
      names: ['A'],
      areas: [facility],
      detailPages: [{ name: 'A', pageIndex: 0, image: 'PNG' }]
    })
    store.getState().renameArea(facility.id, 'B')
    expect(store.getState().detailPages).toEqual([])
  })

  it('keeps a DetailPage when a non-last polygon of its combo is renamed away', () => {
    const facility = square(0, 'A')
    const other = storeAt(0, 'A', 5, 5)
    const store = createAreaStore({
      pages,
      names: ['A'],
      areas: [facility, other],
      detailPages: [{ name: 'A', pageIndex: 0 }]
    })
    store.getState().renameArea(facility.id, 'B')
    expect(store.getState().detailPages).toEqual([{ name: 'A', pageIndex: 0 }])
  })
})

describe('detail editor reconciliation', () => {
  it('closes the editor when its detail page is disabled', () => {
    const store = createAreaStore({
      pages,
      areas: [square(0, 'A')],
      detailPages: [{ name: 'A', pageIndex: 0 }]
    })
    store.getState().openDetailEditor('A', 0)
    store.getState().setDetailPageEnabled('A', 0, false)
    expect(store.getState().detailEditing).toBeNull()
  })

  it('closes the editor when deleting its last source polygon prunes the page', () => {
    const area = square(0, 'A')
    const store = createAreaStore({
      pages,
      areas: [area],
      detailPages: [{ name: 'A', pageIndex: 0 }]
    })
    store.getState().openDetailEditor('A', 0)
    store.getState().deleteArea(area.id)
    expect(store.getState().detailEditing).toBeNull()
  })

  it('closes the editor when renaming its last source polygon prunes the page', () => {
    const area = square(0, 'A')
    const store = createAreaStore({
      pages,
      areas: [area],
      detailPages: [{ name: 'A', pageIndex: 0 }]
    })
    store.getState().openDetailEditor('A', 0)
    store.getState().renameArea(area.id, 'B')
    expect(store.getState().detailEditing).toBeNull()
  })

  it('closes the editor when undo removes its detail page', () => {
    const store = createAreaStore({ pages, names: ['A'], areas: [square(0, 'A')] })
    store.getState().setDetailPageEnabled('A', 0, true)
    store.getState().openDetailEditor('A', 0)
    store.getState().undo()
    expect(store.getState().detailPages).toEqual([])
    expect(store.getState().detailEditing).toBeNull()
  })
})

describe('detail editor and image actions', () => {
  const t0 = { x: 0, y: 0, scale: 1, rotation: 0 }
  const t1 = { x: 10, y: 20, scale: 2, rotation: 0 }
  const t2 = { x: 11, y: 21, scale: 2, rotation: 5 }

  it('opens the editor, switches the active page, and clears selection', () => {
    const area = square(1, 'A')
    const store = createAreaStore({
      pages,
      names: ['A'],
      areas: [area],
      selectedAreaId: area.id,
      detailPages: [{ name: 'A', pageIndex: 1 }]
    })
    store.getState().openDetailEditor('A', 1)
    expect(store.getState().detailEditing).toEqual({ name: 'A', pageIndex: 1 })
    expect(store.getState().activePageIndex).toBe(1)
    expect(store.getState().selectedAreaId).toBeNull()
  })

  it('closes the editor without touching detailPages', () => {
    const store = createAreaStore({
      detailPages: [{ name: 'A', pageIndex: 0 }],
      detailEditing: { name: 'A', pageIndex: 0 }
    })
    store.getState().closeDetailEditor()
    expect(store.getState().detailEditing).toBeNull()
    expect(store.getState().detailPages).toEqual([{ name: 'A', pageIndex: 0 }])
  })

  it('opening and closing the editor does not push undo history', () => {
    const store = createAreaStore({ detailPages: [{ name: 'A', pageIndex: 0 }] })
    store.getState().openDetailEditor('A', 0)
    store.getState().closeDetailEditor()
    expect(store.getState().undoStack).toHaveLength(0)
  })

  it('restores the exact page and camera that preceded a cross-page editor session', () => {
    const store = createAreaStore({
      pages,
      areas: [square(1, 'A')],
      detailPages: [{ name: 'A', pageIndex: 1 }],
      activePageIndex: 0,
      zoom: 1.75,
      pan: { x: 31, y: 47 }
    })
    store.getState().openDetailEditor('A', 1)
    store.getState().setZoom(2.5)
    store.getState().setPan({ x: 100, y: 120 })
    store.getState().closeDetailEditor()
    expect(store.getState().activePageIndex).toBe(0)
    expect(store.getState().zoom).toBe(1.75)
    expect(store.getState().pan).toEqual({ x: 31, y: 47 })
  })

  it('restores a nonzero same-page camera after editor close', () => {
    const store = createAreaStore({
      pages,
      areas: [square(0, 'A')],
      detailPages: [{ name: 'A', pageIndex: 0 }],
      activePageIndex: 0,
      zoom: 1.25,
      pan: { x: 12, y: 18 }
    })
    store.getState().openDetailEditor('A', 0)
    store.getState().setZoom(2)
    store.getState().setPan({ x: 80, y: 90 })
    store.getState().closeDetailEditor()
    expect(store.getState().activePageIndex).toBe(0)
    expect(store.getState().zoom).toBe(1.25)
    expect(store.getState().pan).toEqual({ x: 12, y: 18 })
  })

  it('ignores page navigation while the editor is open', () => {
    const store = createAreaStore({
      pages,
      areas: [square(1, 'A')],
      detailPages: [{ name: 'A', pageIndex: 1 }]
    })
    store.getState().openDetailEditor('A', 1)
    store.getState().setActivePage(0)
    expect(store.getState().activePageIndex).toBe(1)
  })

  it('attaches an image and transform to the enabled page', () => {
    const store = createAreaStore({ detailPages: [{ name: 'A', pageIndex: 0 }] })
    store.getState().setDetailImage('A', 0, 'PNG', t1)
    expect(store.getState().detailPages).toEqual([
      { name: 'A', pageIndex: 0, image: 'PNG', transform: t1 }
    ])
  })

  it('setDetailImage upserts when the page is not yet present', () => {
    const store = createAreaStore({ detailPages: [] })
    store.getState().setDetailImage('A', 0, 'PNG', t1)
    expect(store.getState().detailPages).toEqual([
      { name: 'A', pageIndex: 0, image: 'PNG', transform: t1 }
    ])
  })

  it('coalesces a transform gesture into one undo step and reverts it', () => {
    const store = createAreaStore({
      detailPages: [{ name: 'A', pageIndex: 0, image: 'PNG', transform: t0 }]
    })
    store.getState().beginInteraction()
    store.getState().setDetailTransform('A', 0, t1)
    store.getState().setDetailTransform('A', 0, t2)
    store.getState().endInteraction()
    expect(store.getState().detailPages[0].transform).toEqual(t2)
    expect(store.getState().undoStack).toHaveLength(1)
    store.getState().undo()
    expect(store.getState().detailPages[0].transform).toEqual(t0)
  })

  it('removes the image but keeps the page enabled', () => {
    const store = createAreaStore({
      detailPages: [{ name: 'A', pageIndex: 0, image: 'PNG', transform: t1 }]
    })
    store.getState().removeDetailImage('A', 0)
    expect(store.getState().detailPages).toEqual([{ name: 'A', pageIndex: 0 }])
  })
})
