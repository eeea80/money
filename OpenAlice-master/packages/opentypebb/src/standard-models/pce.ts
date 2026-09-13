/**
 * Personal Consumption Expenditures (PCE) Standard Model.
 * Maps to: openbb_core/provider/standard_models/pce.py
 */

import { z } from 'zod'

export const PersonalConsumptionExpendituresQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type PersonalConsumptionExpendituresQueryParams = z.infer<typeof PersonalConsumptionExpendituresQueryParamsSchema>

export const PersonalConsumptionExpendituresDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  pce: z.number().nullable().default(null).describe('PCE price index.'),
  core_pce: z.number().nullable().default(null).describe('Core PCE price index (excluding food and energy).'),
}).passthrough()

export type PersonalConsumptionExpendituresData = z.infer<typeof PersonalConsumptionExpendituresDataSchema>
