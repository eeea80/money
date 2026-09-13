/**
 * Consumer Price Index Standard Model.
 * Maps to: openbb_core/provider/standard_models/consumer_price_index.py
 */

import { z } from 'zod'

export const ConsumerPriceIndexQueryParamsSchema = z.object({
  country: z.string().default('united_states').describe('The country to get data for.'),
  transform: z.string().default('yoy').describe('Transformation of the CPI data.'),
  frequency: z.enum(['annual', 'quarter', 'monthly']).default('monthly').describe('The frequency of the data.'),
  harmonized: z.boolean().default(false).describe('If true, returns harmonized data.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
}).passthrough()

export type ConsumerPriceIndexQueryParams = z.infer<typeof ConsumerPriceIndexQueryParamsSchema>

export const ConsumerPriceIndexDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  country: z.string().describe('The country.'),
  value: z.number().describe('CPI index value or period change.'),
}).passthrough()

export type ConsumerPriceIndexData = z.infer<typeof ConsumerPriceIndexDataSchema>
