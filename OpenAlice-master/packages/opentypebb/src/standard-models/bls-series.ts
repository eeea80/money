/**
 * BLS Series Standard Model.
 */

import { z } from 'zod'

export const BlsSeriesQueryParamsSchema = z.object({
  symbol: z.string().describe('BLS series ID(s), comma-separated for multiple.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type BlsSeriesQueryParams = z.infer<typeof BlsSeriesQueryParamsSchema>

export const BlsSeriesDataSchema = z.object({
  date: z.string().describe('Observation date.'),
  series_id: z.string().nullable().default(null).describe('BLS series identifier.'),
  value: z.number().nullable().default(null).describe('Observation value.'),
  period: z.string().nullable().default(null).describe('BLS period code (e.g., M01).'),
}).passthrough()

export type BlsSeriesData = z.infer<typeof BlsSeriesDataSchema>
