/**
 * Revenue by Geographic Segments Standard Model.
 * Maps to: openbb_core/provider/standard_models/revenue_geographic.py
 */

import { z } from 'zod'

export const RevenueGeographicQueryParamsSchema = z.object({
  symbol: z.string().describe('Symbol to get data for.'),
}).passthrough()

export type RevenueGeographicQueryParams = z.infer<typeof RevenueGeographicQueryParamsSchema>

export const RevenueGeographicDataSchema = z.object({
  period_ending: z.string().describe('The end date of the reporting period.'),
  fiscal_period: z.string().nullable().default(null).describe('The fiscal period of the reporting period.'),
  fiscal_year: z.number().nullable().default(null).describe('The fiscal year of the reporting period.'),
  filing_date: z.string().nullable().default(null).describe('The filing date of the report.'),
  region: z.string().nullable().default(null).describe('The region represented by the revenue data.'),
  revenue: z.number().describe('The total revenue attributed to the region.'),
}).passthrough()

export type RevenueGeographicData = z.infer<typeof RevenueGeographicDataSchema>
