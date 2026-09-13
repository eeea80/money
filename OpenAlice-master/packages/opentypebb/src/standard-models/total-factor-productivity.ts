/**
 * Total Factor Productivity Standard Model.
 * Maps to: openbb_core/provider/standard_models/total_factor_productivity.py
 */

import { z } from 'zod'

export const TotalFactorProductivityQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type TotalFactorProductivityQueryParams = z.infer<typeof TotalFactorProductivityQueryParamsSchema>

export const TotalFactorProductivityDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  value: z.number().nullable().default(null).describe('Total factor productivity value.'),
}).passthrough()

export type TotalFactorProductivityData = z.infer<typeof TotalFactorProductivityDataSchema>
