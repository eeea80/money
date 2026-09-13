/**
 * FX Rate Service — provides USD exchange rates with a dual-table architecture:
 *
 * 1. **Default table** (hardcoded) — developer-maintained, updated with releases.
 *    Guarantees UTA can run even with zero network connectivity.
 * 2. **Live table** (runtime cache) — populated from the market-data currency client.
 *    Provides fresh rates when available.
 *
 * Lookup priority: live (fresh) → live (stale cache) → default table → 1:1 fallback.
 */

import Decimal from 'decimal.js'
import type { CurrencyClientLike } from '@/domain/market-data/client/types.js'

// ==================== Types ====================

export interface FxRateEntry {
  rate: number
  updatedAt: string  // ISO 8601 date string
}

export type FxRateTable = Record<string, FxRateEntry>

export interface FxRate {
  /** Conversion rate: 1 unit of `from` currency = `rate` units of USD. */
  rate: number
  /** Where this rate came from. */
  source: 'live' | 'cached' | 'default'
  /** When this rate was last updated (ISO 8601). */
  updatedAt: string
  /** True when live data has expired but is still being used. */
  stale?: boolean
}

export interface ConvertResult {
  /** Amount converted to USD (string to prevent IEEE 754 artifacts). */
  usd: string
  /** Present only when a default (hardcoded) rate was used. Includes the updatedAt date. */
  fxWarning?: string
}

// ==================== Default rate table ====================

/**
 * Hardcoded rates (→ USD), manually maintained by developers.
 * Each entry carries an updatedAt timestamp so consumers can judge data freshness.
 * Update these values when releasing new versions.
 */
const DEFAULT_RATES: FxRateTable = {
  // Major fiat
  HKD: { rate: 0.128,    updatedAt: '2026-04-08' },
  EUR: { rate: 1.08,     updatedAt: '2026-04-08' },
  GBP: { rate: 1.27,     updatedAt: '2026-04-08' },
  JPY: { rate: 0.0067,   updatedAt: '2026-04-08' },
  CNY: { rate: 0.138,    updatedAt: '2026-04-08' },
  CNH: { rate: 0.138,    updatedAt: '2026-04-08' },
  CAD: { rate: 0.74,     updatedAt: '2026-04-08' },
  AUD: { rate: 0.65,     updatedAt: '2026-04-08' },
  NZD: { rate: 0.60,     updatedAt: '2026-04-08' },
  SGD: { rate: 0.74,     updatedAt: '2026-04-08' },
  CHF: { rate: 1.13,     updatedAt: '2026-04-08' },
  KRW: { rate: 0.00074,  updatedAt: '2026-04-08' },
  SEK: { rate: 0.095,    updatedAt: '2026-04-08' },
  NOK: { rate: 0.092,    updatedAt: '2026-04-08' },
  DKK: { rate: 0.145,    updatedAt: '2026-04-08' },
  INR: { rate: 0.012,    updatedAt: '2026-04-08' },
  TWD: { rate: 0.031,    updatedAt: '2026-04-08' },
  MXN: { rate: 0.058,    updatedAt: '2026-04-08' },
  ZAR: { rate: 0.054,    updatedAt: '2026-04-08' },
  BRL: { rate: 0.19,     updatedAt: '2026-04-08' },
}

// ==================== Live cache entry ====================

interface LiveCacheEntry {
  rate: number
  updatedAt: string
  fetchedAt: number  // Date.now() — for TTL comparison
}

// ==================== FxService ====================

export class FxService {
  private readonly liveRates = new Map<string, LiveCacheEntry>()
  private readonly ttlMs: number
  private readonly client?: CurrencyClientLike
  /** Track which default-rate currencies have already been warned about, to avoid log spam. */
  private readonly defaultWarned = new Set<string>()
  private readonly hub?: { enabled: boolean; baseUrl: string }
  /** Whole hub FX table, cached. The hub refreshes hourly; 30min here. */
  private hubTable: { rates: Record<string, { rate: number; updatedAt: string }>; fetchedAt: number } | null = null
  private hubDownUntil = 0

  /**
   * @param currencyClient — optional. Without it, FxService works purely from the default table.
   * @param ttlMs — cache TTL in milliseconds. Default 5 minutes.
   * @param hub — optional TraderHub config; one GET serves the whole table.
   */
  constructor(currencyClient?: CurrencyClientLike, ttlMs = 5 * 60_000, hub?: { enabled: boolean; baseUrl: string }) {
    this.client = currencyClient
    this.ttlMs = ttlMs
    this.hub = hub
  }

  /**
   * Hub FX table lookup. DATA boundary: rates are shape- and
   * sanity-checked (finite, > 0) and only ever feed display-level USD
   * conversion — never order placement.
   */
  private async hubRate(key: string): Promise<{ rate: number; updatedAt: string } | null> {
    if (!this.hub?.enabled || !this.hub.baseUrl) return null
    const now = Date.now()
    if (this.hubTable && now - this.hubTable.fetchedAt < 30 * 60_000) {
      return this.hubTable.rates[key] ?? null
    }
    if (now < this.hubDownUntil) return this.hubTable?.rates[key] ?? null
    try {
      const res = await fetch(`${this.hub.baseUrl.replace(/\/+$/, '')}/api/data/fx-rates`, {
        signal: AbortSignal.timeout(5_000),
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { counter?: string; rates?: Record<string, { rate?: unknown; updatedAt?: unknown }> }
      if (data?.counter !== 'USD' || !data.rates) throw new Error('non-contract shape')
      const rates: Record<string, { rate: number; updatedAt: string }> = {}
      for (const [ccy, row] of Object.entries(data.rates)) {
        if (typeof row?.rate === 'number' && Number.isFinite(row.rate) && row.rate > 0) {
          rates[ccy.toUpperCase()] = { rate: row.rate, updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString() }
        }
      }
      if (Object.keys(rates).length === 0) throw new Error('empty table')
      this.hubTable = { rates, fetchedAt: now }
      return rates[key] ?? null
    } catch {
      this.hubDownUntil = now + 60_000
      return this.hubTable?.rates[key] ?? null
    }
  }

  /**
   * Get the USD exchange rate for a given currency.
   *
   * Priority: fresh cache → hub table → vendor client → stale cache →
   * default table → 1:1 fallback.
   */
  async getRate(from: string): Promise<FxRate> {
    const key = from.toUpperCase()
    if (key === 'USD') return { rate: 1, source: 'live', updatedAt: new Date().toISOString() }

    const now = Date.now()
    const cached = this.liveRates.get(key)

    // 1. Fresh live cache
    if (cached && now - cached.fetchedAt < this.ttlMs) {
      return { rate: cached.rate, source: 'live', updatedAt: cached.updatedAt }
    }

    // 2. Hub FX table — one cached GET covers every currency.
    const hub = await this.hubRate(key)
    if (hub) {
      this.liveRates.set(key, { rate: hub.rate, updatedAt: hub.updatedAt, fetchedAt: now })
      return { rate: hub.rate, source: 'live', updatedAt: hub.updatedAt }
    }

    // 3. Per-currency vendor fetch (only if we have a client)
    if (this.client) {
      try {
        const snapshots = await this.client.getSnapshots({
          base: key,
          counter_currencies: 'USD',
          provider: 'yfinance',
        })
        const snap = snapshots.find(s => s.counter_currency?.toUpperCase() === 'USD')
        if (snap && snap.last_rate > 0) {
          const updatedAt = new Date().toISOString()
          this.liveRates.set(key, { rate: snap.last_rate, updatedAt, fetchedAt: now })
          return { rate: snap.last_rate, source: 'live', updatedAt }
        }
      } catch {
        // Silently fall through — stale cache or default table will handle it
      }
    }

    // 4. Stale live cache (expired but better than nothing)
    if (cached) {
      return { rate: cached.rate, source: 'cached', updatedAt: cached.updatedAt, stale: true }
    }

    // 5. Default table
    const def = DEFAULT_RATES[key]
    if (def) {
      if (!this.defaultWarned.has(key)) {
        this.defaultWarned.add(key)
        console.warn(`FxService: using default rate for ${key}/USD = ${def.rate} (from ${def.updatedAt})`)
      }
      return { rate: def.rate, source: 'default', updatedAt: def.updatedAt }
    }

    // 6. Unknown currency — 1:1 fallback
    if (!this.defaultWarned.has(key)) {
      this.defaultWarned.add(key)
      console.warn(`FxService: unknown currency "${key}", defaulting to 1:1 USD`)
    }
    return { rate: 1, source: 'default', updatedAt: '1970-01-01' }
  }

  /**
   * Convert an amount in the given currency to USD.
   * Returns a warning only when the default (hardcoded) table is used.
   */
  async convertToUsd(amount: string, currency: string): Promise<ConvertResult> {
    const d = new Decimal(amount)
    if (d.isZero()) return { usd: '0' }
    const fx = await this.getRate(currency)
    const usd = d.mul(fx.rate).toString()
    if (fx.source === 'default') {
      return { usd, fxWarning: `${currency}: using default rate ${fx.rate} (last updated ${fx.updatedAt})` }
    }
    return { usd }
  }
}
