/**
 * FMP Treasury Rates Model.
 * Maps to: openbb_fmp/models/treasury_rates.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { TreasuryRatesQueryParamsSchema, TreasuryRatesDataSchema } from '../../../standard-models/treasury-rates.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataUrls } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  month_1: 'month1',
  month_2: 'month2',
  month_3: 'month3',
  month_6: 'month6',
  year_1: 'year1',
  year_2: 'year2',
  year_3: 'year3',
  year_5: 'year5',
  year_7: 'year7',
  year_10: 'year10',
  year_20: 'year20',
  year_30: 'year30',
}

export const FMPTreasuryRatesQueryParamsSchema = TreasuryRatesQueryParamsSchema
export type FMPTreasuryRatesQueryParams = z.infer<typeof FMPTreasuryRatesQueryParamsSchema>

export const FMPTreasuryRatesDataSchema = TreasuryRatesDataSchema
export type FMPTreasuryRatesData = z.infer<typeof FMPTreasuryRatesDataSchema>

/**
 * Generate URLs for each 3-month interval between start and end dates.
 */
function generateUrls(startDate: string, endDate: string, apiKey: string): string[] {
  const urls: string[] = []
  const start = new Date(startDate)
  const end = new Date(endDate)

  let current = new Date(start)
  while (current <= end) {
    const next = new Date(current)
    next.setMonth(next.getMonth() + 3)
    const to = next > end ? end : next
    const fromStr = current.toISOString().split('T')[0]
    const toStr = to.toISOString().split('T')[0]
    urls.push(
      `https://financialmodelingprep.com/stable/treasury-rates?from=${fromStr}&to=${toStr}&apikey=${apiKey}`,
    )
    current = next
  }
  return urls
}

export class FMPTreasuryRatesFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPTreasuryRatesQueryParams {
    // Default start_date to 1 year ago, end_date to today
    const now = new Date()
    if (!params.start_date) {
      const oneYearAgo = new Date(now)
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      params.start_date = oneYearAgo.toISOString().split('T')[0]
    }
    if (!params.end_date) {
      params.end_date = now.toISOString().split('T')[0]
    }
    return FMPTreasuryRatesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPTreasuryRatesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const urls = generateUrls(query.start_date!, query.end_date!, apiKey)
    const chunks = await getDataUrls<Record<string, unknown>[]>(urls)
    // Flatten all chunks into a single array
    const results: Record<string, unknown>[] = []
    for (const chunk of chunks) {
      if (Array.isArray(chunk)) {
        results.push(...chunk)
      }
    }
    return results
  }

  static override transformData(
    _query: FMPTreasuryRatesQueryParams,
    data: Record<string, unknown>[],
  ): FMPTreasuryRatesData[] {
    return data
      .map(d => {
        // Normalize percent values (e.g. 4.5 -> 0.045)
        for (const [key, value] of Object.entries(d)) {
          if (key !== 'date' && typeof value === 'number') {
            d[key] = value / 100
          }
        }
        const aliased = applyAliases(d, ALIAS_DICT)
        return FMPTreasuryRatesDataSchema.parse(aliased)
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }
}
