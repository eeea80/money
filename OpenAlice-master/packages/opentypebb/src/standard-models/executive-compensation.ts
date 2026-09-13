/**
 * Executive Compensation Standard Model.
 * Maps to: standard_models/executive_compensation.py
 */

import { z } from 'zod'

export const ExecutiveCompensationQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})
export type ExecutiveCompensationQueryParams = z.infer<typeof ExecutiveCompensationQueryParamsSchema>

const numOrNull = z.number().nullable().default(null)

export const ExecutiveCompensationDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  cik: z.string().nullable().default(null).describe('CIK number.'),
  report_date: z.string().nullable().default(null).describe('Date of reported compensation.'),
  company_name: z.string().nullable().default(null).describe('The name of the company.'),
  executive: z.string().nullable().default(null).describe('Name and position.'),
  year: z.number().nullable().default(null).describe('Year of the compensation.'),
  salary: numOrNull.describe('Base salary.'),
  bonus: numOrNull.describe('Bonus payments.'),
  stock_award: numOrNull.describe('Stock awards.'),
  option_award: numOrNull.describe('Option awards.'),
  incentive_plan_compensation: numOrNull.describe('Incentive plan compensation.'),
  all_other_compensation: numOrNull.describe('All other compensation.'),
  total: numOrNull.describe('Total compensation.'),
}).passthrough()
export type ExecutiveCompensationData = z.infer<typeof ExecutiveCompensationDataSchema>
