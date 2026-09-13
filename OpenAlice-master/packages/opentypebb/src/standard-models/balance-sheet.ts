/**
 * Balance Sheet Standard Model.
 * Maps to: openbb_core/provider/standard_models/balance_sheet.py
 */

import { z } from 'zod'

export const BalanceSheetQueryParamsSchema = z.object({
  symbol: z.string().transform((v) => v.toUpperCase()),
  limit: z.number().int().nonnegative().nullable().default(null).describe('The number of data entries to return.'),
}).passthrough()

export type BalanceSheetQueryParams = z.infer<typeof BalanceSheetQueryParamsSchema>

export const BalanceSheetDataSchema = z.object({
  period_ending: z.string().describe('The end date of the reporting period.'),
  fiscal_period: z.string().nullable().default(null).describe('The fiscal period of the report.'),
  fiscal_year: z.number().int().nullable().default(null).describe('The fiscal year of the fiscal period.'),
}).passthrough()

export type BalanceSheetData = z.infer<typeof BalanceSheetDataSchema>
