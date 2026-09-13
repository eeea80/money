/**
 * Economic Calendar Standard Model.
 * Maps to: standard_models/economic_calendar.py
 */

import { z } from 'zod'

// --- Query Params ---

export const EconomicCalendarQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
})

export type EconomicCalendarQueryParams = z.infer<typeof EconomicCalendarQueryParamsSchema>

// --- Data ---

export const EconomicCalendarDataSchema = z.object({
  date: z.string().nullable().default(null).describe('The date of the data.'),
  country: z.string().nullable().default(null).describe('Country of event.'),
  category: z.string().nullable().default(null).describe('Category of event.'),
  event: z.string().nullable().default(null).describe('Event name.'),
  importance: z.string().nullable().default(null).describe('The importance level for the event.'),
  source: z.string().nullable().default(null).describe('Source of the data.'),
  currency: z.string().nullable().default(null).describe('Currency of the data.'),
  unit: z.string().nullable().default(null).describe('Unit of the data.'),
  consensus: z.union([z.string(), z.number()]).nullable().default(null).describe('Average forecast among a representative group of economists.'),
  previous: z.union([z.string(), z.number()]).nullable().default(null).describe('Value for the previous period after the revision.'),
  revised: z.union([z.string(), z.number()]).nullable().default(null).describe('Revised previous value, if applicable.'),
  actual: z.union([z.string(), z.number()]).nullable().default(null).describe('Latest released value.'),
}).passthrough()

export type EconomicCalendarData = z.infer<typeof EconomicCalendarDataSchema>
