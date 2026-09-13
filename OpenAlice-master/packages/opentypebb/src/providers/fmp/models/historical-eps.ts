/**
 * FMP Historical EPS Model.
 * Maps to: openbb_fmp/models/historical_eps.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { HistoricalEpsQueryParamsSchema, HistoricalEpsDataSchema } from '../../../standard-models/historical-eps.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  eps_actual: 'epsActual',
  eps_estimated: 'epsEstimated',
  revenue_estimated: 'revenueEstimated',
  revenue_actual: 'revenueActual',
  updated: 'lastUpdated',
}

const numOrNull = z.number().nullable().default(null)

export const FMPHistoricalEpsQueryParamsSchema = HistoricalEpsQueryParamsSchema.extend({
  limit: z.coerce.number().nullable().default(null).describe('The number of data entries to return.'),
})
export type FMPHistoricalEpsQueryParams = z.infer<typeof FMPHistoricalEpsQueryParamsSchema>

export const FMPHistoricalEpsDataSchema = HistoricalEpsDataSchema.extend({
  revenue_estimated: numOrNull.describe('Estimated revenue.'),
  revenue_actual: numOrNull.describe('Actual revenue.'),
  updated: z.string().nullable().default(null).describe('Last updated date.'),
}).passthrough()
export type FMPHistoricalEpsData = z.infer<typeof FMPHistoricalEpsDataSchema>

export class FMPHistoricalEpsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPHistoricalEpsQueryParams {
    return FMPHistoricalEpsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPHistoricalEpsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    let url = `https://financialmodelingprep.com/stable/earnings?symbol=${query.symbol}&apikey=${apiKey}`
    if (query.limit) url += `&limit=${query.limit}`
    return getDataMany(url)
  }

  static override transformData(
    _query: FMPHistoricalEpsQueryParams,
    data: Record<string, unknown>[],
  ): FMPHistoricalEpsData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPHistoricalEpsDataSchema.parse(aliased)
    })
  }
}
