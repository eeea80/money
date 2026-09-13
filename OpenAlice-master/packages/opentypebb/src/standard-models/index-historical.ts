/**
 * Index Historical Standard Model.
 * Maps to: openbb_core/provider/standard_models/index_historical.py
 */

import { z } from 'zod'

const numOrNull = z.number().nullable().default(null)

export const IndexHistoricalQueryParamsSchema = z.object({
  symbol: z.string().describe('Symbol to get data for.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
}).passthrough()

export type IndexHistoricalQueryParams = z.infer<typeof IndexHistoricalQueryParamsSchema>

export const IndexHistoricalDataSchema = z.object({
  symbol: z.string().nullable().default(null).describe('Symbol representing the entity.'),
  date: z.string().describe('The date of the data.'),
  open: numOrNull.describe('Opening price.'),
  high: numOrNull.describe('High price.'),
  low: numOrNull.describe('Low price.'),
  close: numOrNull.describe('Close price.'),
  volume: numOrNull.describe('Trading volume.'),
}).passthrough()

export type IndexHistoricalData = z.infer<typeof IndexHistoricalDataSchema>
