/**
 * Income Statement Standard Model.
 * Maps to: openbb_core/provider/standard_models/income_statement.py
 */

import { z } from 'zod'

export const IncomeStatementQueryParamsSchema = z.object({
  symbol: z.string().transform((v) => v.toUpperCase()),
  limit: z.number().int().nonnegative().nullable().default(null).describe('The number of data entries to return.'),
}).passthrough()

export type IncomeStatementQueryParams = z.infer<typeof IncomeStatementQueryParamsSchema>

export const IncomeStatementDataSchema = z.object({
  period_ending: z.string().describe('The end date of the reporting period.'),
  fiscal_period: z.string().nullable().default(null).describe('The fiscal period of the report.'),
  fiscal_year: z.number().int().nullable().default(null).describe('The fiscal year of the fiscal period.'),
}).passthrough()

export type IncomeStatementData = z.infer<typeof IncomeStatementDataSchema>
