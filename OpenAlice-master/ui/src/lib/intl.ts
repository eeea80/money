/**
 * Locale-aware Intl primitives — the single source of truth for which BCP-47
 * locale every formatter in the UI uses, plus the canonical relative-time
 * formatter that replaces the ~10 hand-rolled `timeAgo`/`relativeTime` copies
 * that used to live one-per-component (each pinned to English).
 *
 * Stage relationship: this module is framework-agnostic. Today `_appLocale`
 * stays 'en', so every formatter renders exactly as it did before (en-US).
 * When the i18n locale store lands (Stage 2), it subscribes and calls
 * `setAppLocale()` on every change, and the money/number/date helpers that
 * read `getIntlLocale()` start following the user's language for free.
 *
 * Scope note: this is UI-chrome formatting only. It must never be wired to
 * slug/identifier generation (e.g. ChatWorkspaceSection's month-based
 * workspace name) — those stay 'en' so generated ids don't shift with locale.
 */

export type AppLocale = 'en' | 'zh' | 'ja' | 'zh-Hant'

/** App locale → BCP-47 tag handed to the Intl.* APIs. `zh-Hant` is the
 *  Traditional-Han SCRIPT subtag (region-neutral), not a region tag. */
const BCP47: Record<AppLocale, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
  'zh-Hant': 'zh-Hant',
}

let _appLocale: AppLocale = 'en'

/** Set by the locale store (Stage 2). Until then `_appLocale` stays 'en'. */
export function setAppLocale(locale: AppLocale): void {
  _appLocale = locale
}

export function getAppLocale(): AppLocale {
  return _appLocale
}

/** The BCP-47 tag the formatters read. The one place locale enters Intl.*. */
export function getIntlLocale(): string {
  return BCP47[_appLocale]
}

// ── Relative time ──────────────────────────────────────────────────────────

type RelativeTimeStyle = 'long' | 'short' | 'narrow'

export interface RelativeTimeOptions {
  /**
   * 'narrow' (default) renders "5m ago" in en — byte-identical to the legacy
   * helpers — and "5分钟前" / "5分前" in zh / ja. 'long' → "5 minutes ago".
   */
  style?: RelativeTimeStyle
  /** Returned for null / unparseable input. Default ''. */
  fallback?: string
}

/** ms span of each unit, largest first, for threshold selection. */
const UNIT_MS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
]

/** Under this, render the locale's "now" token instead of "0s ago". */
const NOW_THRESHOLD_MS = 5000

function toEpochMs(input: Date | string | number | null | undefined): number | null {
  if (input == null) return null
  const ms =
    input instanceof Date ? input.getTime()
    : typeof input === 'number' ? input
    : new Date(input).getTime()
  return Number.isFinite(ms) ? ms : null
}

const _rtfCache = new Map<string, Intl.RelativeTimeFormat>()

function rtf(style: RelativeTimeStyle, numeric: 'always' | 'auto'): Intl.RelativeTimeFormat {
  const locale = getIntlLocale()
  const key = `${locale}|${style}|${numeric}`
  let fmt = _rtfCache.get(key)
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat(locale, { numeric, style })
    _rtfCache.set(key, fmt)
  }
  return fmt
}

/**
 * "5m ago" / "5分钟前" / "5分前" — one locale-aware implementation for every
 * "time since X" label in the UI. Accepts a Date, an ISO string, or an epoch
 * in ms. Past times read as "… ago"; future times as "in …".
 */
export function formatRelativeTime(
  input: Date | string | number | null | undefined,
  opts: RelativeTimeOptions = {},
): string {
  const ms = toEpochMs(input)
  if (ms == null) return opts.fallback ?? ''
  const style = opts.style ?? 'narrow'
  const diffMs = ms - Date.now() // past → negative → "… ago"
  const absMs = Math.abs(diffMs)
  if (absMs < NOW_THRESHOLD_MS) {
    // numeric:'auto' gives the locale's "now" / "现在" / "今".
    return rtf(style, 'auto').format(0, 'second')
  }
  const sign = diffMs < 0 ? -1 : 1
  let unit: Intl.RelativeTimeFormatUnit = 'second'
  let value = 0
  for (const [u, span] of UNIT_MS) {
    if (absMs >= span) {
      unit = u
      value = Math.floor(absMs / span) * sign
      break
    }
  }
  return rtf(style, 'always').format(value, unit)
}
