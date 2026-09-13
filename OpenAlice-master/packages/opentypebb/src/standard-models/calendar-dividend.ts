/**
 * Dividend Calendar Standard Model.
 * Maps to: standard_models/calendar_dividend.py
 */

import { z } from 'zod'

// --- Query Params ---

export const CalendarDividendQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
})

export type CalendarDividendQueryParams = z.infer<typeof CalendarDividendQueryParamsSchema>

// --- Data ---

export const CalendarDividendDataSchema = z.object({
  ex_dividend_date: z.string().describe('The ex-dividend date.'),
  symbol: z.string().describe('Symbol representing the entity.'),
  amount: z.number().nullable().default(null).describe('The dividend amount per share.'),
  name: z.string().nullable().default(null).describe('Name of the entity.'),
  record_date: z.string().nullable().default(null).describe('The record date of ownership for eligibility.'),
  payment_date: z.string().nullable().default(null).describe('The payment date of the dividend.'),
  declaration_date: z.string().nullable().default(null).describe('Declaration date of the dividend.'),
}).passthrough()

export type CalendarDividendData = z.infer<typeof CalendarDividendDataSchema>
