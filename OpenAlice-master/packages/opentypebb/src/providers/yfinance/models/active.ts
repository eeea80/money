/**
 * Yahoo Finance Most Active Model.
 * Maps to: openbb_yfinance/models/active.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityPerformanceQueryParamsSchema } from '../../../standard-models/equity-performance.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getPredefinedScreener } from '../utils/helpers.js'
import { YFPredefinedScreenerDataSchema, YF_SCREENER_ALIAS_DICT } from '../utils/references.js'

export const YFActiveQueryParamsSchema = EquityPerformanceQueryParamsSchema.extend({
  limit: z.number().nullable().default(200).describe('Limit the number of results.'),
})
export type YFActiveQueryParams = z.infer<typeof YFActiveQueryParamsSchema>

export const YFActiveDataSchema = YFPredefinedScreenerDataSchema
export type YFActiveData = z.infer<typeof YFActiveDataSchema>

export class YFActiveFetcher extends Fetcher {
  static requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFActiveQueryParams {
    return YFActiveQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFActiveQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return getPredefinedScreener('most_actives', query.limit ?? 200)
  }

  static override transformData(
    query: YFActiveQueryParams,
    data: Record<string, unknown>[],
  ): YFActiveData[] {
    const sorted = [...data].sort((a, b) => {
      const diff = Number(b.regularMarketVolume ?? 0) - Number(a.regularMarketVolume ?? 0)
      return query.sort === 'desc' ? diff : -diff
    })
    return sorted.map(d => {
      const aliased = applyAliases(d, YF_SCREENER_ALIAS_DICT)
      if (typeof aliased.percent_change === 'number') {
        aliased.percent_change = aliased.percent_change / 100
      }
      return YFActiveDataSchema.parse(aliased)
    })
  }
}
