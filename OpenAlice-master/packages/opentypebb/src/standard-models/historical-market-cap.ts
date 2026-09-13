/**
 * Historical Market Cap Standard Model.
 * Maps to: openbb_core/provider/standard_models/historical_market_cap.py
 */

import { z } from 'zod'

export const HistoricalMarketCapQueryParamsSchema = z.object({
  symbol: z.string().describe('Symbol to get data for.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
}).passthrough()

export type HistoricalMarketCapQueryParams = z.infer<typeof HistoricalMarketCapQueryParamsSchema>

export const HistoricalMarketCapDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  date: z.string().describe('The date of the data.'),
  market_cap: z.number().describe('Market capitalization.'),
}).passthrough()

export type HistoricalMarketCapData = z.infer<typeof HistoricalMarketCapDataSchema>
