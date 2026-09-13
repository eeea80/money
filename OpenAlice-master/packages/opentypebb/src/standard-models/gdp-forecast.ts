/**
 * GDP Forecast Standard Model.
 */

import { z } from 'zod'

export const GdpForecastQueryParamsSchema = z.object({
  country: z.string().default('united_states').describe('Country to get GDP forecast for.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
  frequency: z.enum(['annual', 'quarter']).default('annual').describe('Data frequency.'),
}).passthrough()

export type GdpForecastQueryParams = z.infer<typeof GdpForecastQueryParamsSchema>

export const GdpForecastDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  country: z.string().nullable().default(null).describe('Country name.'),
  value: z.number().nullable().default(null).describe('GDP forecast value.'),
}).passthrough()

export type GdpForecastData = z.infer<typeof GdpForecastDataSchema>
