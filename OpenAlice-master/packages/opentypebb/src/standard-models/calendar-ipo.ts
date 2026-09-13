/**
 * IPO Calendar Standard Model.
 * Maps to: standard_models/calendar_ipo.py
 */

import { z } from 'zod'

// --- Query Params ---

export const CalendarIpoQueryParamsSchema = z.object({
  symbol: z.string().nullable().default(null).describe('Symbol to get data for.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
  limit: z.coerce.number().int().nullable().default(100).describe('The number of data entries to return.'),
})

export type CalendarIpoQueryParams = z.infer<typeof CalendarIpoQueryParamsSchema>

// --- Data ---

export const CalendarIpoDataSchema = z.object({
  symbol: z.string().nullable().default(null).describe('Symbol representing the entity.'),
  ipo_date: z.string().nullable().default(null).describe('The date of the IPO.'),
}).passthrough()

export type CalendarIpoData = z.infer<typeof CalendarIpoDataSchema>
