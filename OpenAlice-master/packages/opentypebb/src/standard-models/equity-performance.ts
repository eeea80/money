/**
 * Equity Performance Standard Model.
 * Maps to: openbb_core/provider/standard_models/equity_performance.py
 */

import { z } from 'zod'

export const EquityPerformanceQueryParamsSchema = z.object({
  sort: z.enum(['asc', 'desc']).default('desc').describe("Sort order. Possible values: 'asc', 'desc'. Default: 'desc'."),
}).passthrough()

export type EquityPerformanceQueryParams = z.infer<typeof EquityPerformanceQueryParamsSchema>

export const EquityPerformanceDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity requested in the data.'),
  name: z.string().nullable().default(null).describe('Name of the entity.'),
  price: z.number().describe('Last price.'),
  change: z.number().describe('Change in price.'),
  percent_change: z.number().describe('Percent change.'),
  volume: z.number().nullable().default(null).describe('Trading volume.'),
}).passthrough()

export type EquityPerformanceData = z.infer<typeof EquityPerformanceDataSchema>
