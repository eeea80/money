import { useLocaleStore } from './store'
import type { AppLocale } from '../lib/intl'

/** Current UI locale. Subscribing re-renders the caller on a language switch —
 *  use it in a high component so formatter-only subtrees refresh too. */
export function useLocale(): AppLocale {
  return useLocaleStore((s) => s.locale)
}

/** The locale setter. Side effects (i18next, formatters, <html lang>) are
 *  applied by the subscription in ./index.ts. */
export function useSetLocale(): (locale: AppLocale) => void {
  return useLocaleStore((s) => s.setLocale)
}

/** Display autonyms for the picker — each language in its own script, never
 *  translated (standard language-switcher UX). */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
  'zh-Hant': '繁體中文',
}
