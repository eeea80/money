/**
 * YFinance Historical Dividends Model.
 * Maps to: openbb_yfinance/models/historical_dividends.py
 *
 * All data is split-adjusted.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { HistoricalDividendsQueryParamsSchema, HistoricalDividendsDataSchema } from '../../../standard-models/historical-dividends.js'
import { getHistoricalDividends } from '../utils/helpers.js'

export const YFinanceHistoricalDividendsQueryParamsSchema = HistoricalDividendsQueryParamsSchema
export type YFinanceHistoricalDividendsQueryParams = z.infer<typeof YFinanceHistoricalDividendsQueryParamsSchema>

export const YFinanceHistoricalDividendsDataSchema = HistoricalDividendsDataSchema
export type YFinanceHistoricalDividendsData = z.infer<typeof YFinanceHistoricalDividendsDataSchema>

export class YFinanceHistoricalDividendsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceHistoricalDividendsQueryParams {
    return YFinanceHistoricalDividendsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceHistoricalDividendsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return getHistoricalDividends(
      query.symbol,
      query.start_date,
      query.end_date,
    )
  }

  static override transformData(
    _query: YFinanceHistoricalDividendsQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceHistoricalDividendsData[] {
    return data.map(d => YFinanceHistoricalDividendsDataSchema.parse(d))
  }
}
