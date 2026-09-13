/**
 * FMP Institutional Ownership Model.
 * Maps to: openbb_fmp/models/institutional_ownership.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { InstitutionalOwnershipQueryParamsSchema, InstitutionalOwnershipDataSchema } from '../../../standard-models/institutional-ownership.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  number_of_13f_shares: 'numberOf13Fshares',
  last_number_of_13f_shares: 'lastNumberOf13Fshares',
  number_of_13f_shares_change: 'numberOf13FsharesChange',
  ownership_percent_change: 'changeInOwnershipPercentage',
}

const numOrNull = z.number().nullable().default(null)

export const FMPInstitutionalOwnershipQueryParamsSchema = InstitutionalOwnershipQueryParamsSchema.extend({
  year: z.coerce.number().nullable().default(null).describe('Calendar year for the data. If not provided, the latest year is used.'),
  quarter: z.coerce.number().nullable().default(null).describe('Calendar quarter for the data (1-4). If not provided, the quarter previous to the current quarter is used.'),
})
export type FMPInstitutionalOwnershipQueryParams = z.infer<typeof FMPInstitutionalOwnershipQueryParamsSchema>

export const FMPInstitutionalOwnershipDataSchema = InstitutionalOwnershipDataSchema.extend({
  investors_holding: z.number().describe('Number of investors holding the stock.'),
  last_investors_holding: z.number().describe('Number of investors holding the stock in the last quarter.'),
  investors_holding_change: z.number().describe('Change in the number of investors holding the stock.'),
  number_of_13f_shares: numOrNull.describe('Number of 13F shares.'),
  last_number_of_13f_shares: numOrNull.describe('Number of 13F shares in the last quarter.'),
  number_of_13f_shares_change: numOrNull.describe('Change in the number of 13F shares.'),
  total_invested: z.number().describe('Total amount invested.'),
  last_total_invested: z.number().describe('Total amount invested in the last quarter.'),
  total_invested_change: z.number().describe('Change in the total amount invested.'),
  ownership_percent: numOrNull.describe('Ownership percent as a normalized percent.'),
  last_ownership_percent: numOrNull.describe('Ownership percent in the last quarter.'),
  ownership_percent_change: numOrNull.describe('Change in the ownership percent.'),
  new_positions: z.number().describe('Number of new positions.'),
  last_new_positions: z.number().describe('Number of new positions in the last quarter.'),
  new_positions_change: z.number().describe('Change in the number of new positions.'),
  increased_positions: z.number().describe('Number of increased positions.'),
  last_increased_positions: z.number().describe('Number of increased positions in the last quarter.'),
  increased_positions_change: z.number().describe('Change in the number of increased positions.'),
  closed_positions: z.number().describe('Number of closed positions.'),
  last_closed_positions: z.number().describe('Number of closed positions in the last quarter.'),
  closed_positions_change: z.number().describe('Change in the number of closed positions.'),
  reduced_positions: z.number().describe('Number of reduced positions.'),
  last_reduced_positions: z.number().describe('Number of reduced positions in the last quarter.'),
  reduced_positions_change: z.number().describe('Change in the number of reduced positions.'),
  total_calls: z.number().describe('Total number of call options contracts traded.'),
  last_total_calls: z.number().describe('Total number of call options contracts traded in last quarter.'),
  total_calls_change: z.number().describe('Change in the total number of call options contracts.'),
  total_puts: z.number().describe('Total number of put options contracts traded.'),
  last_total_puts: z.number().describe('Total number of put options contracts traded in last quarter.'),
  total_puts_change: z.number().describe('Change in the total number of put options contracts.'),
  put_call_ratio: z.number().describe('Put-call ratio.'),
  last_put_call_ratio: z.number().describe('Put-call ratio in the last quarter.'),
  put_call_ratio_change: z.number().describe('Change in the put-call ratio.'),
}).passthrough()
export type FMPInstitutionalOwnershipData = z.infer<typeof FMPInstitutionalOwnershipDataSchema>

/** Get current quarter info for default year/quarter */
function getCurrentQuarterInfo(): { year: number; quarter: number } {
  const now = new Date()
  const currentQuarter = Math.ceil((now.getMonth() + 1) / 3)
  // Use previous quarter
  if (currentQuarter === 1) {
    return { year: now.getFullYear() - 1, quarter: 4 }
  }
  return { year: now.getFullYear(), quarter: currentQuarter - 1 }
}

export class FMPInstitutionalOwnershipFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPInstitutionalOwnershipQueryParams {
    return FMPInstitutionalOwnershipQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPInstitutionalOwnershipQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const symbols = query.symbol.split(',').map(s => s.trim()).filter(Boolean)

    let year = query.year
    let quarter = query.quarter

    if (year == null && quarter == null) {
      const info = getCurrentQuarterInfo()
      year = info.year
      quarter = info.quarter
    } else if (year == null) {
      year = new Date().getFullYear()
    } else if (quarter == null) {
      const now = new Date()
      quarter = year < now.getFullYear()
        ? 4
        : Math.max(1, Math.ceil((now.getMonth() + 1) / 3) - 1)
    }

    const results: Record<string, unknown>[] = []
    const settled = await Promise.allSettled(
      symbols.map(symbol =>
        getDataMany(
          `https://financialmodelingprep.com/stable/institutional-ownership/symbol-positions-summary?symbol=${symbol}&year=${year}&quarter=${quarter}&apikey=${apiKey}`,
        ),
      ),
    )

    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value?.length) {
        results.push(...r.value)
      }
    }

    return results
  }

  static override transformData(
    _query: FMPInstitutionalOwnershipQueryParams,
    data: Record<string, unknown>[],
  ): FMPInstitutionalOwnershipData[] {
    return data.map(d => {
      // Normalize percent fields from whole numbers to decimal
      for (const key of ['ownershipPercent', 'lastOwnershipPercent', 'changeInOwnershipPercentage']) {
        if (typeof d[key] === 'number') {
          d[key] = (d[key] as number) / 100
        }
      }
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPInstitutionalOwnershipDataSchema.parse(aliased)
    })
  }
}
