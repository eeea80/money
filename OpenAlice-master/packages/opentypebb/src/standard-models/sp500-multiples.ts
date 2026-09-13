/**
 * SP500 Multiples Standard Model.
 * Maps to: openbb_core/provider/standard_models/sp500_multiples.py
 */

import { z } from 'zod'

export const SP500MultiplesQueryParamsSchema = z.object({
  series_name: z.string().default('pe_month').describe('The name of the series. Defaults to pe_month.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
}).passthrough()

export type SP500MultiplesQueryParams = z.infer<typeof SP500MultiplesQueryParamsSchema>

export const SP500MultiplesDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  name: z.string().describe('Name of the series.'),
  value: z.number().describe('Value of the series.'),
}).passthrough()

export type SP500MultiplesData = z.infer<typeof SP500MultiplesDataSchema>
