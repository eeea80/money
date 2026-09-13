/**
 * House Price Index Standard Model.
 */

import { z } from 'zod'

export const HousePriceIndexQueryParamsSchema = z.object({
  country: z.string().default('united_states').describe('Country to get house price index for.'),
  frequency: z.enum(['annual', 'quarter', 'monthly']).default('quarter').describe('Data frequency.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type HousePriceIndexQueryParams = z.infer<typeof HousePriceIndexQueryParamsSchema>

export const HousePriceIndexDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  country: z.string().nullable().default(null).describe('Country name.'),
  value: z.number().nullable().default(null).describe('House price index value.'),
}).passthrough()

export type HousePriceIndexData = z.infer<typeof HousePriceIndexDataSchema>
