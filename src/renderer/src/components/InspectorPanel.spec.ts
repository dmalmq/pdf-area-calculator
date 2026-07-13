import { describe, expect, it } from 'vitest'

import { groupDetailCandidates } from './InspectorPanel'

describe('groupDetailCandidates', () => {
  it('preserves first-seen facility and floor order', () => {
    const candidates = [
      { name: 'JR East', pageIndex: 4, level: 'B1F', stores: 3 },
      { name: 'JR East', pageIndex: 2, level: '2F', stores: 8 },
      { name: 'Central Mall', pageIndex: 7, level: '1F', stores: 5 }
    ]
    expect(groupDetailCandidates(candidates)).toEqual([
      { name: 'JR East', rows: candidates.slice(0, 2) },
      { name: 'Central Mall', rows: candidates.slice(2) }
    ])
  })
})
