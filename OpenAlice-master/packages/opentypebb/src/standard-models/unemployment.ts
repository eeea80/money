/**
 * Unemployment Standard Model.
 * Maps to: openbb_core/provider/standard_models/unemployment.py
 */

import { z } from 'zod'

export const UnemploymentQueryParamsSchema = z.object({
  country: z.string().default('united_states').describe('The country to get data for.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
  frequency: z.enum(['annual', 'quarter', 'monthly']).default('monthly').describe('Data frequency.'),
}).passthrough()

export type UnemploymentQueryParams = z.infer<typeof UnemploymentQueryParamsSchema>

export const UnemploymentDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  country: z.string().nullable().default(null).describe('Country name.'),
  value: z.number().nullable().default(null).describe('Unemployment rate value (percent).'),
}).passthrough()

export type UnemploymentData = z.infer<typeof UnemploymentDataSchema>
