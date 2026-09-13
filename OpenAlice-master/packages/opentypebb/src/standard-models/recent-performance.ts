/**
 * Recent Performance Standard Model.
 * Maps to: openbb_core/provider/standard_models/recent_performance.py
 */

import { z } from 'zod'

export const RecentPerformanceQueryParamsSchema = z.object({
  symbol: z.string().describe('Symbol to get data for.'),
}).passthrough()

export type RecentPerformanceQueryParams = z.infer<typeof RecentPerformanceQueryParamsSchema>

const numOrNull = z.number().nullable().default(null)

export const RecentPerformanceDataSchema = z.object({
  symbol: z.string().nullable().default(null).describe('The ticker symbol.'),
  one_day: numOrNull.describe('One-day return.'),
  wtd: numOrNull.describe('Week to date return.'),
  one_week: numOrNull.describe('One-week return.'),
  mtd: numOrNull.describe('Month to date return.'),
  one_month: numOrNull.describe('One-month return.'),
  qtd: numOrNull.describe('Quarter to date return.'),
  three_month: numOrNull.describe('Three-month return.'),
  six_month: numOrNull.describe('Six-month return.'),
  ytd: numOrNull.describe('Year to date return.'),
  one_year: numOrNull.describe('One-year return.'),
  two_year: numOrNull.describe('Two-year return.'),
  three_year: numOrNull.describe('Three-year return.'),
  four_year: numOrNull.describe('Four-year return.'),
  five_year: numOrNull.describe('Five-year return.'),
  ten_year: numOrNull.describe('Ten-year return.'),
  max: numOrNull.describe('Return from the beginning of the time series.'),
}).passthrough()

export type RecentPerformanceData = z.infer<typeof RecentPerformanceDataSchema>
