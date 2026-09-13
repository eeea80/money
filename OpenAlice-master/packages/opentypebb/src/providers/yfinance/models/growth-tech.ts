/**
 * Yahoo Finance Growth Technology Equities Model.
 * Maps to: openbb_yfinance/models/growth_tech_equities.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityPerformanceQueryParamsSchema } from '../../../standard-models/equity-performance.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getPredefinedScreener } from '../utils/helpers.js'
import { YFPredefinedScreenerDataSchema, YF_SCREENER_ALIAS_DICT } from '../utils/references.js'

export const YFGrowthTechQueryParamsSchema = EquityPerformanceQueryParamsSchema.extend({
  limit: z.number().nullable().default(200).describe('Limit the number of results.'),
})
export type YFGrowthTechQueryParams = z.infer<typeof YFGrowthTechQueryParamsSchema>

export const YFGrowthTechDataSchema = YFPredefinedScreenerDataSchema
export type YFGrowthTechData = z.infer<typeof YFGrowthTechDataSchema>

export class YFGrowthTechEquitiesFetcher extends Fetcher {
  static requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFGrowthTechQueryParams {
    return YFGrowthTechQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFGrowthTechQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return getPredefinedScreener('growth_technology_stocks', query.limit ?? 200)
  }

  static override transformData(
    query: YFGrowthTechQueryParams,
    data: Record<string, unknown>[],
  ): YFGrowthTechData[] {
    const sorted = [...data].sort((a, b) => {
      const diff = Number(b.regularMarketChangePercent ?? 0) - Number(a.regularMarketChangePercent ?? 0)
      return query.sort === 'desc' ? diff : -diff
    })
    return sorted.map(d => {
      const aliased = applyAliases(d, YF_SCREENER_ALIAS_DICT)
      if (typeof aliased.percent_change === 'number') {
        aliased.percent_change = aliased.percent_change / 100
      }
      return YFGrowthTechDataSchema.parse(aliased)
    })
  }
}
