/**
 * Calendar Splits Standard Model.
 * Maps to: standard_models/calendar_splits.py
 */

import { z } from 'zod'

// --- Query Params ---

export const CalendarSplitsQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
})

export type CalendarSplitsQueryParams = z.infer<typeof CalendarSplitsQueryParamsSchema>

// --- Data ---

export const CalendarSplitsDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  symbol: z.string().describe('Symbol representing the entity.'),
  numerator: z.number().describe('Numerator of the stock split.'),
  denominator: z.number().describe('Denominator of the stock split.'),
}).passthrough()

export type CalendarSplitsData = z.infer<typeof CalendarSplitsDataSchema>
