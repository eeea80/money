/**
 * FRED Regional / GeoFRED Standard Model.
 * Maps to: openbb_core/provider/standard_models/fred_regional.py
 */

import { z } from 'zod'

export const FredRegionalQueryParamsSchema = z.object({
  symbol: z.string().describe('FRED regional series ID (e.g. WIPCPI for per-capita personal income).'),
  region_type: z.string().default('state').describe('Region type: state, msa, county, etc.'),
  date: z.string().nullable().default(null).describe('Observation date in YYYY-MM-DD.'),
  start_date: z.string().nullable().default(null).describe('Start date for data range.'),
  frequency: z.string().nullable().default(null).describe('Data frequency.'),
}).passthrough()

export type FredRegionalQueryParams = z.infer<typeof FredRegionalQueryParamsSchema>

export const FredRegionalDataSchema = z.object({
  date: z.string().describe('Observation date.'),
  region: z.string().nullable().default(null).describe('Region name.'),
  code: z.string().nullable().default(null).describe('Region code.'),
  value: z.number().nullable().default(null).describe('Observation value.'),
}).passthrough()

export type FredRegionalData = z.infer<typeof FredRegionalDataSchema>
