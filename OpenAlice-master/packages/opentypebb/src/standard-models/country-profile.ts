/**
 * Country Profile Standard Model.
 * Maps to: openbb_core/provider/standard_models/country_profile.py
 */

import { z } from 'zod'

export const CountryProfileQueryParamsSchema = z.object({
  country: z.string().transform(v => v.toLowerCase().replace(/ /g, '_')).describe('The country to get data for.'),
}).passthrough()

export type CountryProfileQueryParams = z.infer<typeof CountryProfileQueryParamsSchema>

export const CountryProfileDataSchema = z.object({
  country: z.string().describe('The country.'),
  population: z.number().nullable().default(null).describe('Population.'),
  gdp_usd: z.number().nullable().default(null).describe('Gross Domestic Product, in billions of USD.'),
  gdp_qoq: z.number().nullable().default(null).describe('GDP growth quarter-over-quarter change.'),
  gdp_yoy: z.number().nullable().default(null).describe('GDP growth year-over-year change.'),
  cpi_yoy: z.number().nullable().default(null).describe('Consumer Price Index year-over-year change.'),
  core_yoy: z.number().nullable().default(null).describe('Core Consumer Price Index year-over-year change.'),
  retail_sales_yoy: z.number().nullable().default(null).describe('Retail Sales year-over-year change.'),
  industrial_production_yoy: z.number().nullable().default(null).describe('Industrial Production year-over-year change.'),
  policy_rate: z.number().nullable().default(null).describe('Short term policy rate.'),
  yield_10y: z.number().nullable().default(null).describe('10-year government bond yield.'),
  govt_debt_gdp: z.number().nullable().default(null).describe('Government debt as percent of GDP.'),
  current_account_gdp: z.number().nullable().default(null).describe('Current account balance as percent of GDP.'),
  jobless_rate: z.number().nullable().default(null).describe('Unemployment rate.'),
}).passthrough()

export type CountryProfileData = z.infer<typeof CountryProfileDataSchema>
