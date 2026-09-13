/**
 * Earnings Calendar Standard Model.
 * Maps to: openbb_core/provider/standard_models/calendar_earnings.py
 */

import { z } from 'zod'

export const CalendarEarningsQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
}).passthrough()

export type CalendarEarningsQueryParams = z.infer<typeof CalendarEarningsQueryParamsSchema>

export const CalendarEarningsDataSchema = z.object({
  report_date: z.string().describe('The date of the earnings report.'),
  symbol: z.string().describe('Symbol representing the entity requested in the data.'),
  name: z.string().nullable().default(null).describe('Name of the entity.'),
  eps_previous: z.number().nullable().default(null).describe('The earnings-per-share from the same previously reported period.'),
  eps_consensus: z.number().nullable().default(null).describe('The analyst consensus earnings-per-share estimate.'),
}).passthrough()

export type CalendarEarningsData = z.infer<typeof CalendarEarningsDataSchema>
