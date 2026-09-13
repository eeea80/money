/**
 * Retail Prices Standard Model.
 */

import { z } from 'zod'

export const RetailPricesQueryParamsSchema = z.object({
  country: z.string().default('united_states').describe('Country to get retail price data for.'),
  frequency: z.enum(['annual', 'quarter', 'monthly']).default('monthly').describe('Data frequency.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type RetailPricesQueryParams = z.infer<typeof RetailPricesQueryParamsSchema>

export const RetailPricesDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  country: z.string().nullable().default(null).describe('Country name.'),
  value: z.number().nullable().default(null).describe('Retail price index value.'),
}).passthrough()

export type RetailPricesData = z.infer<typeof RetailPricesDataSchema>
