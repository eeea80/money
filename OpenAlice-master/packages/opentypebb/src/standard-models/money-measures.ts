/**
 * Money Measures Standard Model.
 * Maps to: openbb_core/provider/standard_models/money_measures.py
 */

import { z } from 'zod'

export const MoneyMeasuresQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
  adjusted: z.boolean().default(true).describe('If true, returns seasonally adjusted data.'),
}).passthrough()

export type MoneyMeasuresQueryParams = z.infer<typeof MoneyMeasuresQueryParamsSchema>

export const MoneyMeasuresDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  m1: z.number().nullable().default(null).describe('M1 money supply (billions USD).'),
  m2: z.number().nullable().default(null).describe('M2 money supply (billions USD).'),
}).passthrough()

export type MoneyMeasuresData = z.infer<typeof MoneyMeasuresDataSchema>
