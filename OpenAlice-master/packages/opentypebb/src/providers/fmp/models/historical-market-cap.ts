/**
 * FMP Historical Market Cap Model.
 * Maps to: openbb_fmp/models/historical_market_cap.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { HistoricalMarketCapQueryParamsSchema, HistoricalMarketCapDataSchema } from '../../../standard-models/historical-market-cap.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  market_cap: 'marketCap',
}

export const FMPHistoricalMarketCapQueryParamsSchema = HistoricalMarketCapQueryParamsSchema.extend({
  limit: z.coerce.number().nullable().default(500).describe('The number of data entries to return.'),
})
export type FMPHistoricalMarketCapQueryParams = z.infer<typeof FMPHistoricalMarketCapQueryParamsSchema>

export const FMPHistoricalMarketCapDataSchema = HistoricalMarketCapDataSchema
export type FMPHistoricalMarketCapData = z.infer<typeof FMPHistoricalMarketCapDataSchema>

export class FMPHistoricalMarketCapFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPHistoricalMarketCapQueryParams {
    return FMPHistoricalMarketCapQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPHistoricalMarketCapQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const qs = new URLSearchParams()
    qs.set('symbol', query.symbol)
    qs.set('apikey', apiKey)
    if (query.limit) qs.set('limit', String(query.limit))
    if (query.start_date) qs.set('from', query.start_date)
    if (query.end_date) qs.set('to', query.end_date)
    return getDataMany(
      `https://financialmodelingprep.com/stable/historical-market-capitalization?${qs.toString()}`,
    )
  }

  static override transformData(
    _query: FMPHistoricalMarketCapQueryParams,
    data: Record<string, unknown>[],
  ): FMPHistoricalMarketCapData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPHistoricalMarketCapDataSchema.parse(aliased)
    })
  }
}
