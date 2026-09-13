/**
 * FMP Top Gainers Model.
 * Maps to: openbb_fmp/models/equity_gainers.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityPerformanceQueryParamsSchema, EquityPerformanceDataSchema } from '../../../standard-models/equity-performance.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = { percent_change: 'changesPercentage' }

export const FMPGainersQueryParamsSchema = EquityPerformanceQueryParamsSchema
export type FMPGainersQueryParams = z.infer<typeof FMPGainersQueryParamsSchema>

export const FMPGainersDataSchema = EquityPerformanceDataSchema.extend({
  exchange: z.string().describe('Stock exchange where the security is listed.'),
}).passthrough()
export type FMPGainersData = z.infer<typeof FMPGainersDataSchema>

export class FMPGainersFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPGainersQueryParams {
    return FMPGainersQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPGainersQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(`https://financialmodelingprep.com/stable/biggest-gainers?apikey=${apiKey}`)
  }

  static override transformData(
    query: FMPGainersQueryParams,
    data: Record<string, unknown>[],
  ): FMPGainersData[] {
    const sorted = [...data].sort((a, b) => {
      const diff = Number(b.changesPercentage ?? 0) - Number(a.changesPercentage ?? 0)
      return query.sort === 'desc' ? diff : -diff
    })
    return sorted.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      if (typeof aliased.percent_change === 'number') aliased.percent_change = aliased.percent_change / 100
      return FMPGainersDataSchema.parse(aliased)
    })
  }
}
