/**
 * Revenue By Business Line Standard Model.
 * Maps to: openbb_core/provider/standard_models/revenue_business_line.py
 */

import { z } from 'zod'

export const RevenueBusinessLineQueryParamsSchema = z.object({
  symbol: z.string().describe('Symbol to get data for.'),
}).passthrough()

export type RevenueBusinessLineQueryParams = z.infer<typeof RevenueBusinessLineQueryParamsSchema>

export const RevenueBusinessLineDataSchema = z.object({
  period_ending: z.string().describe('The end date of the reporting period.'),
  fiscal_period: z.string().nullable().default(null).describe('The fiscal period of the reporting period.'),
  fiscal_year: z.number().nullable().default(null).describe('The fiscal year of the reporting period.'),
  filing_date: z.string().nullable().default(null).describe('The filing date of the report.'),
  business_line: z.string().nullable().default(null).describe('The business line represented by the revenue data.'),
  revenue: z.number().describe('The total revenue attributed to the business line.'),
}).passthrough()

export type RevenueBusinessLineData = z.infer<typeof RevenueBusinessLineDataSchema>
