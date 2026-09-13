/**
 * Equity Search Standard Model.
 * Maps to: openbb_core/provider/standard_models/equity_search.py
 */

import { z } from 'zod'

export const EquitySearchQueryParamsSchema = z.object({
  query: z.string().default('').describe('Search query.'),
  is_symbol: z.boolean().default(false).describe('Whether to search by ticker symbol.'),
}).passthrough()

export type EquitySearchQueryParams = z.infer<typeof EquitySearchQueryParamsSchema>

export const EquitySearchDataSchema = z.object({
  symbol: z.string().nullable().default(null).describe('Symbol of the company.'),
  name: z.string().nullable().default(null).describe('Name of the company.'),
}).passthrough()

export type EquitySearchData = z.infer<typeof EquitySearchDataSchema>
