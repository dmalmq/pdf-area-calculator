import type { StoreLabelMode } from './types'

// The label shown for a store given the display mode and the facility's code
// prefix. Returns null when the store should have no tag (mode 'off').
export function storeTagLabel(
  code: string | undefined,
  prefix: string | undefined,
  mode: StoreLabelMode
): string | null {
  if (mode === 'off') return null
  const value = (code ?? '').trim() || '—'
  if (mode === 'code') return value
  // mode 'number': strip a matching prefix, take the first digit run as an
  // integer (drops leading zeros); fall back to the raw value if it has no digits.
  const body = prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value
  const match = body.match(/\d+/)
  return match ? String(Number.parseInt(match[0], 10)) : value
}
