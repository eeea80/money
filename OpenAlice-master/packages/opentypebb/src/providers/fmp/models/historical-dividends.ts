/**
 * FMP Historical Dividends Model.
 * Maps to: openbb_fmp/models/historical_dividends.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { HistoricalDividendsQueryParamsSchema, HistoricalDividendsDataSchema } from '../../../standard-models/historical-dividends.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  ex_dividend_date: 'date',
  amount: 'dividend',
  adjusted_amount: 'adjDividend',
  dividend_yield: 'yield',
  record_date: 'recordDate',
  payment_date: 'paymentDate',
  declaration_date: 'declarationDate',
}

const numOrNull = z.number().nullable().default(null)

export const FMPHistoricalDividendsQueryParamsSchema = HistoricalDividendsQueryParamsSchema.extend({
  limit: z.coerce.number().nullable().default(null).describe('The number of data entries to return.'),
})
export type FMPHistoricalDividendsQueryParams = z.infer<typeof FMPHistoricalDividendsQueryParamsSchema>

export const FMPHistoricalDividendsDataSchema = HistoricalDividendsDataSchema.extend({
  declaration_date: z.string().nullable().default(null).describe('Declaration date of the dividend.'),
  record_date: z.string().nullable().default(null).describe('Record date of the dividend.'),
  payment_date: z.string().nullable().default(null).describe('Payment date of the dividend.'),
  adjusted_amount: numOrNull.describe('Adjusted dividend amount.'),
  dividend_yield: numOrNull.describe('Dividend yield.'),
  frequency: z.string().nullable().default(null).describe('Frequency of the dividend.'),
}).passthrough()
export type FMPHistoricalDividendsData = z.infer<typeof FMPHistoricalDividendsDataSchema>

export class FMPHistoricalDividendsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPHistoricalDividendsQueryParams {
    return FMPHistoricalDividendsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPHistoricalDividendsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    let url = `https://financialmodelingprep.com/stable/dividends?symbol=${query.symbol}&apikey=${apiKey}`
    if (query.limit) url += `&limit=${query.limit}`
    return getDataMany(url)
  }

  static override transformData(
    _query: FMPHistoricalDividendsQueryParams,
    data: Record<string, unknown>[],
  ): FMPHistoricalDividendsData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPHistoricalDividendsDataSchema.parse(aliased)
    })
  }
}
