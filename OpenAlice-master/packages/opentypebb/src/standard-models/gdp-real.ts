/**
 * GDP Real Standard Model.
 */

import { z } from 'zod'

export const GdpRealQueryParamsSchema = z.object({
  country: z.string().default('united_states').describe('Country to get real GDP for.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
  frequency: z.enum(['annual', 'quarter']).default('annual').describe('Data frequency.'),
}).passthrough()

export type GdpRealQueryParams = z.infer<typeof GdpRealQueryParamsSchema>

export const GdpRealDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  country: z.string().nullable().default(null).describe('Country name.'),
  value: z.number().nullable().default(null).describe('Real GDP value.'),
}).passthrough()

export type GdpRealData = z.infer<typeof GdpRealDataSchema>
