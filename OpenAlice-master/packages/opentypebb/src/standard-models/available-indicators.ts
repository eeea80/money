/**
 * Available Indicators Standard Model.
 * Maps to: openbb_core/provider/standard_models/available_indicators.py
 */

import { z } from 'zod'

export const AvailableIndicatorsQueryParamsSchema = z.object({}).passthrough()

export type AvailableIndicatorsQueryParams = z.infer<typeof AvailableIndicatorsQueryParamsSchema>

export const AvailableIndicatorsDataSchema = z.object({
  symbol_root: z.string().nullable().default(null).describe('The root symbol representing the indicator.'),
  symbol: z.string().nullable().default(null).describe('Symbol representing the entity.'),
  country: z.string().nullable().default(null).describe('The name of the country, region, or entity represented by the symbol.'),
  iso: z.string().nullable().default(null).describe('The ISO code of the country, region, or entity.'),
  description: z.string().nullable().default(null).describe('The description of the indicator.'),
  frequency: z.string().nullable().default(null).describe('The frequency of the indicator data.'),
}).passthrough()

export type AvailableIndicatorsData = z.infer<typeof AvailableIndicatorsDataSchema>
