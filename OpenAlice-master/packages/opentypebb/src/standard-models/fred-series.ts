/**
 * FRED Series Standard Model.
 * Maps to: openbb_core/provider/standard_models/fred_series.py
 */

import { z } from 'zod'

export const FredSeriesQueryParamsSchema = z.object({
  symbol: z.string().describe('FRED series ID(s), comma-separated for multiple.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
  limit: z.number().nullable().default(null).describe('Max observations per series.'),
  frequency: z.string().nullable().default(null).describe('Aggregation frequency.'),
}).passthrough()

export type FredSeriesQueryParams = z.infer<typeof FredSeriesQueryParamsSchema>

export const FredSeriesDataSchema = z.object({
  date: z.string().describe('Observation date.'),
}).passthrough()

export type FredSeriesData = z.infer<typeof FredSeriesDataSchema>
