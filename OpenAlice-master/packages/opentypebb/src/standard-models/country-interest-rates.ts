/**
 * Country Interest Rates Standard Model.
 * Maps to: openbb_core/provider/standard_models/country_interest_rates.py
 */

import { z } from 'zod'

export const CountryInterestRatesQueryParamsSchema = z.object({
  country: z.string().default('united_states').describe('The country to get data for.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
}).passthrough()

export type CountryInterestRatesQueryParams = z.infer<typeof CountryInterestRatesQueryParamsSchema>

export const CountryInterestRatesDataSchema = z.object({
  date: z.string().nullable().default(null).describe('The date of the data.'),
  value: z.number().nullable().default(null).describe('The interest rate value.'),
  country: z.string().nullable().default(null).describe('Country for which the interest rate is given.'),
}).passthrough()

export type CountryInterestRatesData = z.infer<typeof CountryInterestRatesDataSchema>
