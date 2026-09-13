/**
 * Futures Historical Price Standard Model.
 * Maps to: openbb_core/provider/standard_models/futures_historical.py
 */

import { z } from 'zod'

export const FuturesHistoricalQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
  expiration: z.string().nullable().default(null).describe('Future expiry date with format YYYY-MM.'),
}).passthrough()

export type FuturesHistoricalQueryParams = z.infer<typeof FuturesHistoricalQueryParamsSchema>

export const FuturesHistoricalDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  open: z.number().describe('Opening price.'),
  high: z.number().describe('High price.'),
  low: z.number().describe('Low price.'),
  close: z.number().describe('Close price.'),
  volume: z.number().describe('Trading volume.'),
}).passthrough()

export type FuturesHistoricalData = z.infer<typeof FuturesHistoricalDataSchema>
