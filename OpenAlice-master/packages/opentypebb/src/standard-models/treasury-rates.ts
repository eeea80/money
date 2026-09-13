/**
 * Treasury Rates Standard Model.
 * Maps to: openbb_core/provider/standard_models/treasury_rates.py
 */

import { z } from 'zod'

const rateField = z.number().nullable().default(null)

export const TreasuryRatesQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
}).passthrough()

export type TreasuryRatesQueryParams = z.infer<typeof TreasuryRatesQueryParamsSchema>

export const TreasuryRatesDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  week_4: rateField.describe('4 week Treasury bills rate.'),
  month_1: rateField.describe('1 month Treasury rate.'),
  month_2: rateField.describe('2 month Treasury rate.'),
  month_3: rateField.describe('3 month Treasury rate.'),
  month_6: rateField.describe('6 month Treasury rate.'),
  year_1: rateField.describe('1 year Treasury rate.'),
  year_2: rateField.describe('2 year Treasury rate.'),
  year_3: rateField.describe('3 year Treasury rate.'),
  year_5: rateField.describe('5 year Treasury rate.'),
  year_7: rateField.describe('7 year Treasury rate.'),
  year_10: rateField.describe('10 year Treasury rate.'),
  year_20: rateField.describe('20 year Treasury rate.'),
  year_30: rateField.describe('30 year Treasury rate.'),
}).passthrough()

export type TreasuryRatesData = z.infer<typeof TreasuryRatesDataSchema>
