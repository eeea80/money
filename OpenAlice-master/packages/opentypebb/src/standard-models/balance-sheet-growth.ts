/**
 * Balance Sheet Growth Standard Model.
 * Maps to: standard_models/balance_sheet_growth.py
 */

import { z } from 'zod'

// --- Query Params ---

export const BalanceSheetGrowthQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
  limit: z.coerce.number().int().nullable().default(null).describe('The number of data entries to return.'),
})

export type BalanceSheetGrowthQueryParams = z.infer<typeof BalanceSheetGrowthQueryParamsSchema>

// --- Data ---

export const BalanceSheetGrowthDataSchema = z.object({
  period_ending: z.string().describe('The end date of the reporting period.'),
  fiscal_period: z.string().nullable().default(null).describe('The fiscal period of the report.'),
  fiscal_year: z.coerce.number().int().nullable().default(null).describe('The fiscal year of the fiscal period.'),
}).passthrough()

export type BalanceSheetGrowthData = z.infer<typeof BalanceSheetGrowthDataSchema>
