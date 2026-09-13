/**
 * Senior Loan Officer Opinion Survey (SLOOS) Standard Model.
 * Maps to: openbb_core/provider/standard_models/sloos.py
 */

import { z } from 'zod'

export const SloosQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type SloosQueryParams = z.infer<typeof SloosQueryParamsSchema>

export const SloosDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  ci_loan_tightening: z.number().nullable().default(null).describe('Net % tightening standards for C&I loans to large firms.'),
  consumer_loan_tightening: z.number().nullable().default(null).describe('Net % tightening standards for consumer loans.'),
}).passthrough()

export type SloosData = z.infer<typeof SloosDataSchema>
