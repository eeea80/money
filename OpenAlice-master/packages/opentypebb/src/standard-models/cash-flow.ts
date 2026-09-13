/**
 * Cash Flow Statement Standard Model.
 * Maps to: openbb_core/provider/standard_models/cash_flow_statement.py
 */

import { z } from 'zod'

export const CashFlowStatementQueryParamsSchema = z.object({
  symbol: z.string().transform((v) => v.toUpperCase()),
  limit: z.number().int().nonnegative().nullable().default(5).describe('The number of data entries to return.'),
}).passthrough()

export type CashFlowStatementQueryParams = z.infer<typeof CashFlowStatementQueryParamsSchema>

export const CashFlowStatementDataSchema = z.object({
  period_ending: z.string().describe('The end date of the reporting period.'),
  fiscal_period: z.string().nullable().default(null).describe('The fiscal period of the report.'),
  fiscal_year: z.number().int().nullable().default(null).describe('The fiscal year of the fiscal period.'),
}).passthrough()

export type CashFlowStatementData = z.infer<typeof CashFlowStatementDataSchema>
