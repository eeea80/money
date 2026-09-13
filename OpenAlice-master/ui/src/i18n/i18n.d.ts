/**
 * Strict-TS key safety for react-i18next: `t('settings.title')` autocompletes
 * and a typo'd key is a compile error — the i18n analogue of the persist
 * store's loud-fail. Keys are inferred from the English catalog (the source of
 * truth); zh/ja are structurally enforced separately via the `Resources` type.
 */

import 'i18next'
import type { en } from './locales/en'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof en
    }
  }
}
