/**
 * FMP Forward EBITDA Estimates Model.
 * Maps to: openbb_fmp/models/forward_ebitda_estimates.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { ForwardEbitdaEstimatesQueryParamsSchema, ForwardEbitdaEstimatesDataSchema } from '../../../standard-models/forward-ebitda-estimates.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPForwardEbitdaEstimatesQueryParamsSchema = ForwardEbitdaEstimatesQueryParamsSchema.extend({
  fiscal_period: z.enum(['annual', 'quarter']).nullable().default(null).describe('The fiscal period of the estimate.'),
  limit: z.coerce.number().int().nullable().default(null).describe('The number of data entries to return.'),
  include_historical: z.boolean().default(false).describe('If true, include historical data.'),
})

export type FMPForwardEbitdaEstimatesQueryParams = z.infer<typeof FMPForwardEbitdaEstimatesQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  period_ending: 'date',
  high_estimate: 'ebitdaHigh',
  low_estimate: 'ebitdaLow',
  mean: 'ebitdaAvg',
}

export const FMPForwardEbitdaEstimatesDataSchema = ForwardEbitdaEstimatesDataSchema.extend({}).passthrough()
export type FMPForwardEbitdaEstimatesData = z.infer<typeof FMPForwardEbitdaEstimatesDataSchema>

// --- Fetcher ---

export class FMPForwardEbitdaEstimatesFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPForwardEbitdaEstimatesQueryParams {
    return FMPForwardEbitdaEstimatesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPForwardEbitdaEstimatesQueryParams,
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
    query: FMPForwardEbitdaEstimatesQueryParams,
    data: Record<string, unknown>[],
  ): FMPForwardEbitdaEstimatesData[] {
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
      return FMPForwardEbitdaEstimatesDataSchema.parse(aliased)
    })
  }
}
