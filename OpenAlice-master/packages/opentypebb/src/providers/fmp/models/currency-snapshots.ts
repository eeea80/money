/**
 * FMP Currency Snapshots Model.
 * Maps to: openbb_fmp/models/currency_snapshots.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CurrencySnapshotsQueryParamsSchema, CurrencySnapshotsDataSchema } from '../../../standard-models/currency-snapshots.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'

const ALIAS_DICT: Record<string, string> = {
  last_rate: 'price',
  high: 'dayHigh',
  low: 'dayLow',
  ma50: 'priceAvg50',
  ma200: 'priceAvg200',
  year_high: 'yearHigh',
  year_low: 'yearLow',
  prev_close: 'previousClose',
  change_percent: 'changePercentage',
  last_rate_timestamp: 'timestamp',
}

const numOrNull = z.number().nullable().default(null)

export const FMPCurrencySnapshotsQueryParamsSchema = CurrencySnapshotsQueryParamsSchema
export type FMPCurrencySnapshotsQueryParams = z.infer<typeof FMPCurrencySnapshotsQueryParamsSchema>

export const FMPCurrencySnapshotsDataSchema = CurrencySnapshotsDataSchema.extend({
  change: numOrNull.describe('The change in the price from the previous close.'),
  change_percent: numOrNull.describe('The change percent from the previous close.'),
  ma50: numOrNull.describe('The 50-day moving average.'),
  ma200: numOrNull.describe('The 200-day moving average.'),
  year_high: numOrNull.describe('The 52-week high.'),
  year_low: numOrNull.describe('The 52-week low.'),
  last_rate_timestamp: z.string().nullable().default(null).describe('The timestamp of the last rate.'),
}).passthrough()
export type FMPCurrencySnapshotsData = z.infer<typeof FMPCurrencySnapshotsDataSchema>

export class FMPCurrencySnapshotsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPCurrencySnapshotsQueryParams {
    // Uppercase the base
    if (typeof params.base === 'string') params.base = params.base.toUpperCase()
    if (typeof params.counter_currencies === 'string') {
      params.counter_currencies = params.counter_currencies.toUpperCase()
    }
    return FMPCurrencySnapshotsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    _query: FMPCurrencySnapshotsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(
      `https://financialmodelingprep.com/stable/batch-forex-quotes?short=false&apikey=${apiKey}`,
    )
  }

  static override transformData(
    query: FMPCurrencySnapshotsQueryParams,
    data: Record<string, unknown>[],
  ): FMPCurrencySnapshotsData[] {
    if (!data || data.length === 0) {
      throw new EmptyDataError('No data was returned from the FMP endpoint.')
    }

    const results: FMPCurrencySnapshotsData[] = []
    const bases = query.base.toUpperCase().split(',')
    const counterCurrencies = query.counter_currencies
      ? query.counter_currencies.toUpperCase().split(',')
      : null

    for (const base of bases) {
      for (const d of data) {
        const symbol = String(d.symbol ?? '')
        const name = String(d.name ?? '')

        // Check if this pair matches
        let isMatch = false
        let baseCurrency = base
        let counterCurrency = ''

        if (query.quote_type === 'indirect') {
          // Indirect: base currency is on the left (e.g., USD/EUR -> looking for USD as base)
          if (symbol.startsWith(base)) {
            isMatch = true
            const parts = name.split('/')
            counterCurrency = parts.length > 1 ? parts[1].trim() : symbol.replace(base, '')
          }
        } else {
          // Direct: base currency is on the right (e.g., EUR/USD -> looking for USD as base)
          if (symbol.endsWith(base)) {
            isMatch = true
            const parts = name.split('/')
            counterCurrency = parts.length > 0 ? parts[0].trim() : symbol.replace(base, '')
          }
        }

        if (!isMatch) continue

        // Filter counter currencies if specified
        if (counterCurrencies && !counterCurrencies.includes(counterCurrency)) continue

        // Normalize change_percent
        const entry = { ...d }
        if (typeof entry.changePercentage === 'number') {
          entry.changePercentage = entry.changePercentage / 100
        }
        // Convert Unix timestamp to ISO string
        if (typeof entry.timestamp === 'number') {
          entry.timestamp = new Date((entry.timestamp as number) * 1000).toISOString()
        }

        const aliased = applyAliases(entry, ALIAS_DICT)
        aliased.base_currency = baseCurrency
        aliased.counter_currency = counterCurrency

        try {
          results.push(FMPCurrencySnapshotsDataSchema.parse(aliased))
        } catch {
          // Skip entries that fail validation
        }
      }
    }

    if (results.length === 0) {
      throw new EmptyDataError('No data was found using the applied filters. Check the parameters.')
    }

    return results
  }
}
