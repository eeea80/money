/**
 * FMP Equity Historical Price Model.
 * Maps to: openbb_fmp/models/equity_historical.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityHistoricalQueryParamsSchema, EquityHistoricalDataSchema } from '../../../standard-models/equity-historical.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getHistoricalOhlc } from '../utils/helpers.js'

// --- Query Params ---

export const FMPEquityHistoricalQueryParamsSchema = EquityHistoricalQueryParamsSchema.extend({
  interval: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d']).default('1d').describe('Time interval of the data.'),
  adjustment: z.enum(['splits_only', 'splits_and_dividends', 'unadjusted']).default('splits_only').describe('Type of adjustment for historical prices. Only applies to daily data.'),
})

export type FMPEquityHistoricalQueryParams = z.infer<typeof FMPEquityHistoricalQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  open: 'adjOpen',
  high: 'adjHigh',
  low: 'adjLow',
  close: 'adjClose',
}

export const FMPEquityHistoricalDataSchema = EquityHistoricalDataSchema.extend({
  change: z.number().nullable().default(null).describe('Change in the price from the previous close.'),
  change_percent: z.number().nullable().default(null).describe('Change in the price from the previous close, as a normalized percent.'),
}).passthrough()

export type FMPEquityHistoricalData = z.infer<typeof FMPEquityHistoricalDataSchema>

// --- Fetcher ---

export class FMPEquityHistoricalFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEquityHistoricalQueryParams {
    const now = new Date()
    const oneYearAgo = new Date(now)
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

    if (params.start_date == null) {
      params.start_date = oneYearAgo.toISOString().split('T')[0]
    }
    if (params.end_date == null) {
      params.end_date = now.toISOString().split('T')[0]
    }

    return FMPEquityHistoricalQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEquityHistoricalQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return getHistoricalOhlc(query, credentials)
  }

  static override transformData(
    query: FMPEquityHistoricalQueryParams,
    data: Record<string, unknown>[],
  ): FMPEquityHistoricalData[] {
    if (!data || data.length === 0) {
      throw new EmptyDataError('No data returned from FMP for the given query.')
    }

    const multiSymbol = query.symbol.split(',').length > 1
    const sorted = [...data].sort((a, b) => {
      if (multiSymbol) {
        const dateCompare = String(a.date ?? '').localeCompare(String(b.date ?? ''))
        return dateCompare !== 0 ? dateCompare : String(a.symbol ?? '').localeCompare(String(b.symbol ?? ''))
      }
      return String(a.date ?? '').localeCompare(String(b.date ?? ''))
    })

    return sorted.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      // Normalize percent
      if (typeof aliased.change_percent === 'number') {
        aliased.change_percent = aliased.change_percent / 100
      }
      return FMPEquityHistoricalDataSchema.parse(aliased)
    })
  }
}
