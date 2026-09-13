/**
 * University of Michigan Consumer Sentiment Standard Model.
 * Maps to: openbb_core/provider/standard_models/university_of_michigan.py
 */

import { z } from 'zod'

export const UniversityOfMichiganQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type UniversityOfMichiganQueryParams = z.infer<typeof UniversityOfMichiganQueryParamsSchema>

export const UniversityOfMichiganDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  consumer_sentiment: z.number().nullable().default(null).describe('Index of Consumer Sentiment.'),
  current_conditions: z.number().nullable().default(null).describe('Index of Current Economic Conditions.'),
  expectations: z.number().nullable().default(null).describe('Index of Consumer Expectations.'),
  inflation_expectation_1y: z.number().nullable().default(null).describe('Median expected price change next 12 months (%).'),
  inflation_expectation_5y: z.number().nullable().default(null).describe('Median expected price change next 5 years (%).'),
}).passthrough()

export type UniversityOfMichiganData = z.infer<typeof UniversityOfMichiganDataSchema>
