/**
 * Yahoo Finance Top Gainers Model.
 * Maps to: openbb_yfinance/models/gainers.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityPerformanceQueryParamsSchema } from '../../../standard-models/equity-performance.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getPredefinedScreener } from '../utils/helpers.js'
import { YFPredefinedScreenerDataSchema, YF_SCREENER_ALIAS_DICT } from '../utils/references.js'

export const YFGainersQueryParamsSchema = EquityPerformanceQueryParamsSchema.extend({
  limit: z.number().nullable().default(200).describe('Limit the number of results.'),
})
export type YFGainersQueryParams = z.infer<typeof YFGainersQueryParamsSchema>

export const YFGainersDataSchema = YFPredefinedScreenerDataSchema
export type YFGainersData = z.infer<typeof YFGainersDataSchema>

export class YFGainersFetcher extends Fetcher {
  static requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFGainersQueryParams {
    return YFGainersQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFGainersQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const results = await getPredefinedScreener('day_gainers', query.limit ?? 200)
    return results
  }

  static override transformData(
    query: YFGainersQueryParams,
    data: Record<string, unknown>[],
  ): YFGainersData[] {
    const sorted = [...data].sort((a, b) => {
      const diff = Number(b.regularMarketChangePercent ?? 0) - Number(a.regularMarketChangePercent ?? 0)
      return query.sort === 'desc' ? diff : -diff
    })
    return sorted.map(d => {
      const aliased = applyAliases(d, YF_SCREENER_ALIAS_DICT)
      if (typeof aliased.percent_change === 'number') {
        aliased.percent_change = aliased.percent_change / 100
      }
      return YFGainersDataSchema.parse(aliased)
    })
  }
}
