/**
 * Historical Splits Standard Model.
 * Maps to: standard_models/historical_splits.py
 */

import { z } from 'zod'

export const HistoricalSplitsQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})
export type HistoricalSplitsQueryParams = z.infer<typeof HistoricalSplitsQueryParamsSchema>

export const HistoricalSplitsDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  numerator: z.number().nullable().default(null).describe('Numerator of the split.'),
  denominator: z.number().nullable().default(null).describe('Denominator of the split.'),
  split_ratio: z.string().nullable().default(null).describe('Split ratio.'),
}).passthrough()
export type HistoricalSplitsData = z.infer<typeof HistoricalSplitsDataSchema>
