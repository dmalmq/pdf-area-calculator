import type { ScaleMode } from '../state/types'

const MM_PER_PT_SPEC = 25.4 / 72

export function resolveMmPerPt(m: ScaleMode | null): number | null {
  if (!m) return null
  if (m.kind === 'custom') return m.mmPerPt
  if (m.kind === 'ratio') return MM_PER_PT_SPEC * m.n

  const len = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y)
  return len > 0 ? (m.realMeters * 1000) / len : null
}
