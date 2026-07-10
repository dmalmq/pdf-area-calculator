import { describe, expect, it } from 'vitest'

import { storeTagLabel } from './storeLabel'

describe('storeTagLabel', () => {
  it('returns the full code in code mode', () => {
    expect(storeTagLabel('S本館007', 'S本館', 'code')).toBe('S本館007')
  })

  it('returns the integer part in number mode, stripping the prefix and leading zeros', () => {
    expect(storeTagLabel('S本館007', 'S本館', 'number')).toBe('7')
  })

  it('finds the first digit run in number mode even without a prefix', () => {
    expect(storeTagLabel('S本館007', undefined, 'number')).toBe('7')
  })

  it('ignores a non-numeric suffix in number mode', () => {
    expect(storeTagLabel('ts002A', 'ts', 'number')).toBe('2')
  })

  it('falls back to the raw value when there are no digits', () => {
    expect(storeTagLabel('abc', undefined, 'number')).toBe('abc')
  })

  it('shows an em dash for a missing code in code and number modes', () => {
    expect(storeTagLabel(undefined, 'x', 'code')).toBe('—')
    expect(storeTagLabel(undefined, 'x', 'number')).toBe('—')
  })

  it('returns null in off mode', () => {
    expect(storeTagLabel('S本館007', 'S本館', 'off')).toBeNull()
  })

  it('preserves a digit run beyond Number.MAX_SAFE_INTEGER exactly', () => {
    expect(storeTagLabel('9007199254740993', undefined, 'number')).toBe('9007199254740993')
  })
})
