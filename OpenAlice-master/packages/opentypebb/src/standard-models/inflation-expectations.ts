/**
 * Inflation Expectations Standard Model.
 * Maps to: openbb_core/provider/standard_models/inflation_expectations.py
 */

import { z } from 'zod'

export const InflationExpectationsQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type InflationExpectationsQueryParams = z.infer<typeof InflationExpectationsQueryParamsSchema>

export const InflationExpectationsDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  michigan_1y: z.number().nullable().default(null).describe('University of Michigan 1-year inflation expectation.'),
  michigan_5y: z.number().nullable().default(null).describe('University of Michigan 5-year inflation expectation.'),
  breakeven_5y: z.number().nullable().default(null).describe('5-Year breakeven inflation rate (T5YIE).'),
  breakeven_10y: z.number().nullable().default(null).describe('10-Year breakeven inflation rate (T10YIE).'),
}).passthrough()

export type InflationExpectationsData = z.infer<typeof InflationExpectationsDataSchema>
