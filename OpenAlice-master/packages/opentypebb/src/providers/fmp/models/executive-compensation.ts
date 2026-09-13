/**
 * FMP Executive Compensation Model.
 * Maps to: openbb_fmp/models/executive_compensation.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { ExecutiveCompensationQueryParamsSchema, ExecutiveCompensationDataSchema } from '../../../standard-models/executive-compensation.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  company_name: 'companyName',
  industry: 'industryTitle',
  url: 'link',
  executive: 'nameAndPosition',
  report_date: 'filingDate',
}

export const FMPExecutiveCompensationQueryParamsSchema = ExecutiveCompensationQueryParamsSchema.extend({
  year: z.coerce.number().default(-1).describe('Filters results by year, enter 0 for all data available. Default is the most recent year in the dataset, -1.'),
})
export type FMPExecutiveCompensationQueryParams = z.infer<typeof FMPExecutiveCompensationQueryParamsSchema>

export const FMPExecutiveCompensationDataSchema = ExecutiveCompensationDataSchema.extend({
  accepted_date: z.string().nullable().default(null).describe('Date the filing was accepted.'),
  url: z.string().nullable().default(null).describe('URL to the filing data.'),
}).passthrough()
export type FMPExecutiveCompensationData = z.infer<typeof FMPExecutiveCompensationDataSchema>

export class FMPExecutiveCompensationFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPExecutiveCompensationQueryParams {
    return FMPExecutiveCompensationQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPExecutiveCompensationQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const symbols = query.symbol.split(',').map(s => s.trim()).filter(Boolean)
    const results: Record<string, unknown>[] = []

    const settled = await Promise.allSettled(
      symbols.map(symbol =>
        getDataMany(
          `https://financialmodelingprep.com/stable/governance-executive-compensation?symbol=${symbol}&apikey=${apiKey}`,
        ),
      ),
    )

    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value?.length) {
        results.push(...r.value)
      }
    }

    if (!results.length) {
      throw new EmptyDataError('No executive compensation data found.')
    }

    return results
  }

  static override transformData(
    query: FMPExecutiveCompensationQueryParams,
    data: Record<string, unknown>[],
  ): FMPExecutiveCompensationData[] {
    const symbols = query.symbol.split(',').map(s => s.trim()).filter(Boolean)
    const filtered: FMPExecutiveCompensationData[] = []

    for (const symbol of symbols) {
      const symbolData = data.filter(d => String(d.symbol).toUpperCase() === symbol.toUpperCase())

      if (symbolData.length && query.year !== 0) {
        // Get max year or filter by specific year
        const targetYear = query.year === -1
          ? Math.max(...symbolData.map(d => Number(d.year ?? 0)))
          : query.year

        const yearData = symbolData.filter(d => Number(d.year ?? 0) === targetYear)
        for (const d of yearData) {
          const aliased = applyAliases(d, ALIAS_DICT)
          filtered.push(FMPExecutiveCompensationDataSchema.parse(aliased))
        }
      } else {
        // Return all data sorted by year descending
        const sorted = [...symbolData].sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0))
        for (const d of sorted) {
          const aliased = applyAliases(d, ALIAS_DICT)
          filtered.push(FMPExecutiveCompensationDataSchema.parse(aliased))
        }
      }
    }

    if (!filtered.length) {
      throw new EmptyDataError('No data found for given symbols and year.')
    }

    return filtered
  }
}
