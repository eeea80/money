/**
 * ETF Countries Standard Model.
 * Maps to: standard_models/etf_countries.py
 */

import { z } from 'zod'

export const EtfCountriesQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})
export type EtfCountriesQueryParams = z.infer<typeof EtfCountriesQueryParamsSchema>

export const EtfCountriesDataSchema = z.object({
  symbol: z.string().nullable().default(null).describe('Symbol representing the entity.'),
  country: z.string().describe('Country of exposure.'),
  weight: z.number().describe('Exposure of the ETF to the country in normalized percentage points.'),
}).passthrough()
export type EtfCountriesData = z.infer<typeof EtfCountriesDataSchema>
