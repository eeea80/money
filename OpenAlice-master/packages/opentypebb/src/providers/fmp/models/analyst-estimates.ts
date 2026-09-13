/**
 * FMP Analyst Estimates Model.
 * Maps to: openbb_fmp/models/analyst_estimates.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { AnalystEstimatesQueryParamsSchema, AnalystEstimatesDataSchema } from '../../../standard-models/analyst-estimates.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPAnalystEstimatesQueryParamsSchema = AnalystEstimatesQueryParamsSchema.extend({
  period: z.enum(['annual', 'quarter']).default('annual').describe('Time period of the data to return.'),
  limit: z.coerce.number().int().nullable().default(null).describe('The number of data entries to return.'),
})

export type FMPAnalystEstimatesQueryParams = z.infer<typeof FMPAnalystEstimatesQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  estimated_revenue_low: 'revenueLow',
  estimated_revenue_high: 'revenueHigh',
  estimated_revenue_avg: 'revenueAvg',
  estimated_sga_expense_low: 'sgaExpenseLow',
  estimated_sga_expense_high: 'sgaExpenseHigh',
  estimated_sga_expense_avg: 'sgaExpenseAvg',
  estimated_ebitda_low: 'ebitdaLow',
  estimated_ebitda_high: 'ebitdaHigh',
  estimated_ebitda_avg: 'ebitdaAvg',
  estimated_ebit_low: 'ebitLow',
  estimated_ebit_high: 'ebitHigh',
  estimated_ebit_avg: 'ebitAvg',
  estimated_net_income_low: 'netIncomeLow',
  estimated_net_income_high: 'netIncomeHigh',
  estimated_net_income_avg: 'netIncomeAvg',
  estimated_eps_low: 'epsLow',
  estimated_eps_high: 'epsHigh',
  estimated_eps_avg: 'epsAvg',
  number_analyst_estimated_revenue: 'numAnalystsRevenue',
  number_analysts_estimated_eps: 'numAnalystsEps',
}

export const FMPAnalystEstimatesDataSchema = AnalystEstimatesDataSchema.extend({}).passthrough()
export type FMPAnalystEstimatesData = z.infer<typeof FMPAnalystEstimatesDataSchema>

// --- Fetcher ---

export class FMPAnalystEstimatesFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPAnalystEstimatesQueryParams {
    return FMPAnalystEstimatesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPAnalystEstimatesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const url = 'https://financialmodelingprep.com/stable/analyst-estimates'
      + `?symbol=${query.symbol}`
      + `&period=${query.period}`
      + (query.limit ? `&limit=${query.limit}` : '')
      + `&apikey=${apiKey}`
    return getDataMany(url)
  }

  static override transformData(
    query: FMPAnalystEstimatesQueryParams,
    data: Record<string, unknown>[],
  ): FMPAnalystEstimatesData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPAnalystEstimatesDataSchema.parse(aliased)
    })
  }
}
