import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { messages, type Locale } from './messages'

export type { Locale } from './messages'

const STORAGE_KEY = 'pdf-area-locale'

function readStoredLocale(): Locale {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    return value === 'en' ? 'en' : 'ja'
  } catch {
    return 'ja'
  }
}

interface LocaleState {
  locale: Locale
  setLocale(locale: Locale): void
}

export const localeStore = createStore<LocaleState>((set) => ({
  locale: readStoredLocale(),
  setLocale(locale) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      // Ignore storage failures; the in-memory choice still applies for the session.
    }
    set({ locale })
  }
}))

export type TParams = Record<string, string | number>

export function translate(locale: Locale, key: string, params?: TParams): string {
  const table = messages[locale] ?? messages.ja
  let out = table[key] ?? messages.ja[key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      out = out.split(`{${name}}`).join(String(value))
    }
  }
  return out
}

// Live translation for imperative code (App toasts, keyboard handler): reads the
// current locale at call time so it never captures a stale value.
export function t(key: string, params?: TParams): string {
  return translate(localeStore.getState().locale, key, params)
}

// Reactive translator for components: subscribes to the locale so the component
// re-renders on a language switch, then resolves against the current locale.
export function useT(): (key: string, params?: TParams) => string {
  const locale = useStore(localeStore, (s) => s.locale)
  return (key, params) => translate(locale, key, params)
}
