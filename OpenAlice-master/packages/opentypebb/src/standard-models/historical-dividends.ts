/**
 * Historical Dividends Standard Model.
 * Maps to: standard_models/historical_dividends.py
 */

import { z } from 'zod'

export const HistoricalDividendsQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
})
export type HistoricalDividendsQueryParams = z.infer<typeof HistoricalDividendsQueryParamsSchema>

export const HistoricalDividendsDataSchema = z.object({
  symbol: z.string().nullable().default(null).describe('Symbol representing the entity.'),
  ex_dividend_date: z.string().describe('The ex-dividend date - the date on which the stock begins trading without rights to the dividend.'),
  amount: z.number().describe('The dividend amount per share.'),
}).passthrough()
export type HistoricalDividendsData = z.infer<typeof HistoricalDividendsDataSchema>
