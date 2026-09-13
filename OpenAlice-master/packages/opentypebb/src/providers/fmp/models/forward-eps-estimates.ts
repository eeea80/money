/**
 * FMP Forward EPS Estimates Model.
 * Maps to: openbb_fmp/models/forward_eps_estimates.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { ForwardEpsEstimatesQueryParamsSchema, ForwardEpsEstimatesDataSchema } from '../../../standard-models/forward-eps-estimates.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPForwardEpsEstimatesQueryParamsSchema = ForwardEpsEstimatesQueryParamsSchema.extend({
  fiscal_period: z.enum(['annual', 'quarter']).nullable().default(null).describe('The fiscal period of the estimate.'),
  limit: z.coerce.number().int().nullable().default(null).describe('The number of data entries to return.'),
  include_historical: z.boolean().default(false).describe('If true, include historical data.'),
})

export type FMPForwardEpsEstimatesQueryParams = z.infer<typeof FMPForwardEpsEstimatesQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  number_of_analysts: 'numberAnalystsEps',
  high_estimate: 'epsHigh',
  low_estimate: 'epsLow',
  mean: 'epsAvg',
}

export const FMPForwardEpsEstimatesDataSchema = ForwardEpsEstimatesDataSchema.extend({}).passthrough()
export type FMPForwardEpsEstimatesData = z.infer<typeof FMPForwardEpsEstimatesDataSchema>

// --- Fetcher ---

export class FMPForwardEpsEstimatesFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPForwardEpsEstimatesQueryParams {
    return FMPForwardEpsEstimatesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPForwardEpsEstimatesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const url = 'https://financialmodelingprep.com/stable/analyst-estimates'
      + `?symbol=${query.symbol}`
      + (query.fiscal_period ? `&period=${query.fiscal_period}` : '')
      + (query.limit ? `&limit=${query.limit}` : '')
      + `&apikey=${apiKey}`
    return getDataMany(url)
  }

  static override transformData(
    query: FMPForwardEpsEstimatesQueryParams,
    data: Record<string, unknown>[],
  ): FMPForwardEpsEstimatesData[] {
    // Filter to current/future fiscal years unless include_historical
    let filtered = data
    if (!query.include_historical) {
      const currentYear = new Date().getFullYear()
      filtered = data.filter(d => {
        const fy = Number(d.calendarYear ?? d.fiscal_year ?? 0)
        return fy >= currentYear
      })
    }
    return filtered.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPForwardEpsEstimatesDataSchema.parse(aliased)
    })
  }
}
