/**
 * Unusual Options Standard Model.
 * Maps to: openbb_core/provider/standard_models/options_unusual.py
 */

import { z } from 'zod'

export const OptionsUnusualQueryParamsSchema = z.object({
  symbol: z.string().nullable().default(null).transform(v => v ? v.toUpperCase() : null).describe('Symbol to get data for (the underlying symbol).'),
}).passthrough()

export type OptionsUnusualQueryParams = z.infer<typeof OptionsUnusualQueryParamsSchema>

export const OptionsUnusualDataSchema = z.object({
  underlying_symbol: z.string().nullable().default(null).describe('Symbol of the underlying asset.'),
  contract_symbol: z.string().describe('Contract symbol for the option.'),
}).passthrough()

export type OptionsUnusualData = z.infer<typeof OptionsUnusualDataSchema>
