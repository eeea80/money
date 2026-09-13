/**
 * FMP Revenue By Business Line Model.
 * Maps to: openbb_fmp/models/revenue_business_line.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { RevenueBusinessLineQueryParamsSchema, RevenueBusinessLineDataSchema } from '../../../standard-models/revenue-business-line.js'
import { getDataMany } from '../utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'

export const FMPRevenueBusinessLineQueryParamsSchema = RevenueBusinessLineQueryParamsSchema.extend({
  period: z.enum(['quarter', 'annual']).default('annual').describe('Fiscal period.'),
})
export type FMPRevenueBusinessLineQueryParams = z.infer<typeof FMPRevenueBusinessLineQueryParamsSchema>

export const FMPRevenueBusinessLineDataSchema = RevenueBusinessLineDataSchema
export type FMPRevenueBusinessLineData = z.infer<typeof FMPRevenueBusinessLineDataSchema>

export class FMPRevenueBusinessLineFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPRevenueBusinessLineQueryParams {
    return FMPRevenueBusinessLineQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPRevenueBusinessLineQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(
      `https://financialmodelingprep.com/stable/revenue-product-segmentation?symbol=${query.symbol}&period=${query.period}&structure=flat&apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPRevenueBusinessLineQueryParams,
    data: Record<string, unknown>[],
  ): FMPRevenueBusinessLineData[] {
    if (!data || data.length === 0) {
      throw new EmptyDataError('The request was returned empty.')
    }

    const results: FMPRevenueBusinessLineData[] = []

    for (const item of data) {
      const periodEnding = item.date as string | undefined
      const fiscalYear = item.fiscalYear as number | undefined
      const fiscalPeriod = item.period as string | undefined
      const segment = (item.data ?? {}) as Record<string, unknown>

      for (const [businessLine, revenueValue] of Object.entries(segment)) {
        if (revenueValue != null) {
          const revenue = Number(revenueValue)
          if (!isNaN(revenue)) {
            results.push(
              FMPRevenueBusinessLineDataSchema.parse({
                period_ending: periodEnding,
                fiscal_year: fiscalYear,
                fiscal_period: fiscalPeriod,
                business_line: businessLine.trim(),
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
