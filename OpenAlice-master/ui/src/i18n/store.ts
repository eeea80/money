import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppLocale } from '../lib/intl'

/**
 * Locale preference store — the single source of truth for the UI language.
 *
 * Default is 'en'; we do NOT auto-detect navigator.language. During the i18n
 * rollout that's deliberate: a half-translated surface should never ambush a
 * zh/ja user who never asked to switch — they opt in via the Settings picker.
 *
 * Persistence mirrors the workspace store's loud-fail contract (see
 * tabs/store.ts): a `version` bump clears stored state, NO migrate function.
 *
 * This store stays pure (no i18next / intl imports) so the wiring is strictly
 * one-directional: i18n/index.ts subscribes here and applies the side effects.
 */

interface LocaleStore {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
}

export const useLocaleStore = create<LocaleStore>()(
  persist(
    (set) => ({
      locale: 'en',
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: 'openalice.locale.v1',
      version: 1,
    },
  ),
)

/** Persisted locale at boot (zustand persist rehydrates localStorage sync). */
export function readInitialLocale(): AppLocale {
  return useLocaleStore.getState().locale
}
