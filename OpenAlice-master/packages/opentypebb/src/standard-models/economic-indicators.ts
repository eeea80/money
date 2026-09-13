/**
 * Economic Indicators Standard Model.
 * Maps to: openbb_core/provider/standard_models/economic_indicators.py
 */

import { z } from 'zod'

export const EconomicIndicatorsQueryParamsSchema = z.object({
  symbol: z.string().describe('Symbol to get data for.'),
  country: z.string().nullable().default(null).describe('The country to get data for.'),
  frequency: z.string().nullable().default(null).describe('The frequency of the data.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
}).passthrough()

export type EconomicIndicatorsQueryParams = z.infer<typeof EconomicIndicatorsQueryParamsSchema>

export const EconomicIndicatorsDataSchema = z.object({
  date: z.string().nullable().default(null).describe('The date of the data.'),
  symbol_root: z.string().nullable().default(null).describe('The root symbol for the indicator (e.g. GDP).'),
  symbol: z.string().nullable().default(null).describe('Symbol representing the entity.'),
  country: z.string().nullable().default(null).describe('The country represented by the data.'),
  value: z.number().nullable().default(null).describe('The value of the indicator.'),
}).passthrough()

export type EconomicIndicatorsData = z.infer<typeof EconomicIndicatorsDataSchema>
