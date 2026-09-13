/**
 * FMP Currency Historical Price Model.
 * Maps to: openbb_fmp/models/currency_historical.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CurrencyHistoricalQueryParamsSchema, CurrencyHistoricalDataSchema } from '../../../standard-models/currency-historical.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getHistoricalOhlc } from '../utils/helpers.js'

export const FMPCurrencyHistoricalQueryParamsSchema = CurrencyHistoricalQueryParamsSchema.extend({
  interval: z.enum(['1m', '5m', '1h', '1d']).default('1d').describe('Time interval of the data.'),
})
export type FMPCurrencyHistoricalQueryParams = z.infer<typeof FMPCurrencyHistoricalQueryParamsSchema>

export const FMPCurrencyHistoricalDataSchema = CurrencyHistoricalDataSchema.extend({
  change: z.number().nullable().default(null).describe('Change in the price from the previous close.'),
  change_percent: z.number().nullable().default(null).describe('Percent change in the price from the previous close.'),
}).passthrough()
export type FMPCurrencyHistoricalData = z.infer<typeof FMPCurrencyHistoricalDataSchema>

export class FMPCurrencyHistoricalFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPCurrencyHistoricalQueryParams {
    const now = new Date()
    const oneYearAgo = new Date(now)
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    if (params.start_date == null) params.start_date = oneYearAgo.toISOString().split('T')[0]
    if (params.end_date == null) params.end_date = now.toISOString().split('T')[0]
    return FMPCurrencyHistoricalQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPCurrencyHistoricalQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return getHistoricalOhlc(query, credentials)
  }

  static override transformData(
    query: FMPCurrencyHistoricalQueryParams,
    data: Record<string, unknown>[],
  ): FMPCurrencyHistoricalData[] {
    const multiSymbol = query.symbol.split(',').length > 1
    const sorted = [...data].sort((a, b) => {
      if (multiSymbol) {
        const dc = String(a.date ?? '').localeCompare(String(b.date ?? ''))
        return dc !== 0 ? dc : String(a.symbol ?? '').localeCompare(String(b.symbol ?? ''))
      }
      return String(a.date ?? '').localeCompare(String(b.date ?? ''))
    })
    return sorted.map((d) => {
      if (typeof d.change_percent === 'number') d.change_percent = d.change_percent / 100
      return FMPCurrencyHistoricalDataSchema.parse(d)
    })
  }
}
