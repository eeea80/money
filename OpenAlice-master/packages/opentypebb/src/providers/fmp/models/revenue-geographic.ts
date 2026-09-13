/**
 * FMP Revenue Geographic Model.
 * Maps to: openbb_fmp/models/revenue_geographic.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { RevenueGeographicQueryParamsSchema, RevenueGeographicDataSchema } from '../../../standard-models/revenue-geographic.js'
import { getDataMany } from '../utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'

export const FMPRevenueGeographicQueryParamsSchema = RevenueGeographicQueryParamsSchema.extend({
  period: z.enum(['quarter', 'annual']).default('annual').describe('Fiscal period.'),
})
export type FMPRevenueGeographicQueryParams = z.infer<typeof FMPRevenueGeographicQueryParamsSchema>

export const FMPRevenueGeographicDataSchema = RevenueGeographicDataSchema
export type FMPRevenueGeographicData = z.infer<typeof FMPRevenueGeographicDataSchema>

export class FMPRevenueGeographicFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPRevenueGeographicQueryParams {
    return FMPRevenueGeographicQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPRevenueGeographicQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(
      `https://financialmodelingprep.com/stable/revenue-geographic-segmentation?symbol=${query.symbol}&period=${query.period}&structure=flat&apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPRevenueGeographicQueryParams,
    data: Record<string, unknown>[],
  ): FMPRevenueGeographicData[] {
    if (!data || data.length === 0) {
      throw new EmptyDataError('The request was returned empty.')
    }

    const results: FMPRevenueGeographicData[] = []

    for (const item of data) {
      const periodEnding = item.date as string | undefined
      const fiscalYear = item.fiscalYear as number | undefined
      const fiscalPeriod = item.period as string | undefined
      const segment = (item.data ?? {}) as Record<string, unknown>

      for (const [region, revenueValue] of Object.entries(segment)) {
        if (revenueValue != null) {
          const revenue = Number(revenueValue)
          if (!isNaN(revenue)) {
            results.push(
              FMPRevenueGeographicDataSchema.parse({
                period_ending: periodEnding,
                fiscal_year: fiscalYear,
                fiscal_period: fiscalPeriod,
                region: region.replace('Segment', '').trim(),
                revenue,
              }),
            )
          }
        }
      }
    }

    if (results.length === 0) {
      throw new EmptyDataError('Unknown error while transforming the data.')
    }

    return results.sort((a, b) => {
      const dateComp = String(a.period_ending ?? '').localeCompare(String(b.period_ending ?? ''))
      if (dateComp !== 0) return dateComp
      return (a.revenue ?? 0) - (b.revenue ?? 0)
    })
  }
}
