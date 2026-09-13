/**
 * Financial Ratios Standard Model.
 * Maps to: openbb_core/provider/standard_models/financial_ratios.py
 */

import { z } from 'zod'

export const FinancialRatiosQueryParamsSchema = z.object({
  symbol: z.string().transform((v) => v.toUpperCase()),
  limit: z.number().int().nullable().default(null).describe('The number of data entries to return.'),
}).passthrough()

export type FinancialRatiosQueryParams = z.infer<typeof FinancialRatiosQueryParamsSchema>

export const FinancialRatiosDataSchema = z.object({
  symbol: z.string().nullable().default(null).describe('Symbol representing the entity requested in the data.'),
  period_ending: z.string().nullable().default(null).describe('The date of the data.'),
  fiscal_period: z.string().nullable().default(null).describe('Period of the financial ratios.'),
  fiscal_year: z.number().int().nullable().default(null).describe('Fiscal year.'),
}).passthrough()

export type FinancialRatiosData = z.infer<typeof FinancialRatiosDataSchema>
