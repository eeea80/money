/**
 * Equity Screener Standard Model.
 * Maps to: standard_models/equity_screener.py
 */

import { z } from 'zod'

export const EquityScreenerQueryParamsSchema = z.object({})
export type EquityScreenerQueryParams = z.infer<typeof EquityScreenerQueryParamsSchema>

export const EquityScreenerDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  name: z.string().nullable().default(null).describe('Name of the company.'),
}).passthrough()
export type EquityScreenerData = z.infer<typeof EquityScreenerDataSchema>
