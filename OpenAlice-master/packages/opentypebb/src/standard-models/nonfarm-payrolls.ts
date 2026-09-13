/**
 * Nonfarm Payrolls Standard Model.
 * Maps to: openbb_core/provider/standard_models/nonfarm_payrolls.py
 */

import { z } from 'zod'

export const NonfarmPayrollsQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type NonfarmPayrollsQueryParams = z.infer<typeof NonfarmPayrollsQueryParamsSchema>

export const NonfarmPayrollsDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  total_nonfarm: z.number().nullable().default(null).describe('Total nonfarm payrolls (thousands).'),
  private_sector: z.number().nullable().default(null).describe('Private sector payrolls (thousands).'),
  government: z.number().nullable().default(null).describe('Government payrolls (thousands).'),
}).passthrough()

export type NonfarmPayrollsData = z.infer<typeof NonfarmPayrollsDataSchema>
