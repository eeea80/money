/**
 * Yahoo Finance Top Losers Model.
 * Maps to: openbb_yfinance/models/losers.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityPerformanceQueryParamsSchema } from '../../../standard-models/equity-performance.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getPredefinedScreener } from '../utils/helpers.js'
import { YFPredefinedScreenerDataSchema, YF_SCREENER_ALIAS_DICT } from '../utils/references.js'

export const YFLosersQueryParamsSchema = EquityPerformanceQueryParamsSchema.extend({
  limit: z.number().nullable().default(200).describe('Limit the number of results.'),
})
export type YFLosersQueryParams = z.infer<typeof YFLosersQueryParamsSchema>

export const YFLosersDataSchema = YFPredefinedScreenerDataSchema
export type YFLosersData = z.infer<typeof YFLosersDataSchema>

export class YFLosersFetcher extends Fetcher {
  static requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFLosersQueryParams {
    return YFLosersQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFLosersQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return getPredefinedScreener('day_losers', query.limit ?? 200)
  }

  static override transformData(
    query: YFLosersQueryParams,
    data: Record<string, unknown>[],
  ): YFLosersData[] {
    const sorted = [...data].sort((a, b) => {
      const diff = Number(b.regularMarketChangePercent ?? 0) - Number(a.regularMarketChangePercent ?? 0)
      return query.sort === 'desc' ? diff : -diff
    })
    return sorted.map(d => {
      const aliased = applyAliases(d, YF_SCREENER_ALIAS_DICT)
      if (typeof aliased.percent_change === 'number') {
        aliased.percent_change = aliased.percent_change / 100
      }
      return YFLosersDataSchema.parse(aliased)
    })
  }
}
