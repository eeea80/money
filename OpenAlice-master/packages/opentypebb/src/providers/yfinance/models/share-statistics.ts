/**
 * YFinance Share Statistics Model.
 * Maps to: openbb_yfinance/models/share_statistics.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { ShareStatisticsQueryParamsSchema, ShareStatisticsDataSchema } from '../../../standard-models/share-statistics.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getQuoteSummary } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  outstanding_shares: 'sharesOutstanding',
  float_shares: 'floatShares',
  date: 'dateShortInterest',
  implied_shares_outstanding: 'impliedSharesOutstanding',
  short_interest: 'sharesShort',
  short_percent_of_float: 'shortPercentOfFloat',
  days_to_cover: 'shortRatio',
  short_interest_prev_month: 'sharesShortPriorMonth',
  short_interest_prev_date: 'sharesShortPreviousMonthDate',
  insider_ownership: 'heldPercentInsiders',
  institution_ownership: 'heldPercentInstitutions',
  institution_float_ownership: 'institutionsFloatPercentHeld',
  institutions_count: 'institutionsCount',
}

const numOrNull = z.number().nullable().default(null)

export const YFinanceShareStatisticsQueryParamsSchema = ShareStatisticsQueryParamsSchema
export type YFinanceShareStatisticsQueryParams = z.infer<typeof YFinanceShareStatisticsQueryParamsSchema>

export const YFinanceShareStatisticsDataSchema = ShareStatisticsDataSchema.extend({
  implied_shares_outstanding: numOrNull.describe('Implied Shares Outstanding of common equity, assuming the conversion of all convertible subsidiary equity into common.'),
  short_interest: numOrNull.describe('Number of shares that are reported short.'),
  short_percent_of_float: numOrNull.describe('Percentage of shares that are reported short, as a normalized percent.'),
  days_to_cover: numOrNull.describe('Number of days to repurchase the shares as a ratio of average daily volume.'),
  short_interest_prev_month: numOrNull.describe('Number of shares that were reported short in the previous month.'),
  short_interest_prev_date: z.string().nullable().default(null).describe('Date of the previous month short interest report.'),
  insider_ownership: numOrNull.describe('Percentage of shares held by insiders, as a normalized percent.'),
  institution_ownership: numOrNull.describe('Percentage of shares held by institutions, as a normalized percent.'),
  institution_float_ownership: numOrNull.describe('Percentage of float held by institutions, as a normalized percent.'),
  institutions_count: numOrNull.describe('Number of institutions holding shares.'),
}).passthrough()
export type YFinanceShareStatisticsData = z.infer<typeof YFinanceShareStatisticsDataSchema>

export class YFinanceShareStatisticsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceShareStatisticsQueryParams {
    return YFinanceShareStatisticsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceShareStatisticsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbols = query.symbol.split(',').map(s => s.trim()).filter(Boolean)
    const results: Record<string, unknown>[] = []

    const settled = await Promise.allSettled(
      symbols.map(async (symbol) => {
        const data = await getQuoteSummary(symbol, [
          'defaultKeyStatistics',
          'majorHoldersBreakdown',
        ])
        return data
      }),
    )

    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        const data = r.value as Record<string, unknown>
        // Only include if we got shares outstanding
        if (data.sharesOutstanding != null) {
          results.push(data)
        }
      }
    }

    if (!results.length) {
      throw new EmptyDataError('No share statistics data returned')
    }

    return results
  }

  static override transformData(
    _query: YFinanceShareStatisticsQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceShareStatisticsData[] {
    return data.map(d => {
      // Convert epoch timestamps for date fields
      if (typeof d.dateShortInterest === 'number') {
        d.dateShortInterest = new Date(d.dateShortInterest * 1000).toISOString().slice(0, 10)
      }
      if (typeof d.sharesShortPreviousMonthDate === 'number') {
        d.sharesShortPreviousMonthDate = new Date(d.sharesShortPreviousMonthDate * 1000).toISOString().slice(0, 10)
      }

      // yahoo-finance2 BUG: its schema marks sharesShortPriorMonth (a share
      // COUNT) as a date, so 134,866,074 shares parses as epoch seconds →
      // "Apr 1974". Recover the count by inverting the bogus conversion.
      if (d.sharesShortPriorMonth instanceof Date) {
        d.sharesShortPriorMonth = Math.round(d.sharesShortPriorMonth.getTime() / 1000)
      } else if (typeof d.sharesShortPriorMonth === 'string') {
        const ms = Date.parse(d.sharesShortPriorMonth)
        if (!Number.isNaN(ms)) d.sharesShortPriorMonth = Math.round(ms / 1000)
      }

      // yahoo-finance2 uses insidersPercentHeld / institutionsPercentHeld
      // while yfinance Python uses heldPercentInsiders / heldPercentInstitutions
      // Map yahoo-finance2 names to the alias dict expected names
      if (d.insidersPercentHeld != null && d.heldPercentInsiders == null) {
        d.heldPercentInsiders = d.insidersPercentHeld
      }
      if (d.institutionsPercentHeld != null && d.heldPercentInstitutions == null) {
        d.heldPercentInstitutions = d.institutionsPercentHeld
      }

      const aliased = applyAliases(d, ALIAS_DICT)
      // Yahoo intermittently serialises large counts (e.g. sharesShortPriorMonth)
      // as strings — coerce numeric-looking strings before the strict parse.
      for (const [k, v] of Object.entries(aliased)) {
        if (k.endsWith('_date') || k === 'date' || k === 'symbol') continue
        if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) {
          aliased[k] = Number(v)
        }
      }
      return YFinanceShareStatisticsDataSchema.parse(aliased)
    })
  }
}
