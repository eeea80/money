/**
 * Historical Employees Standard Model.
 * Maps to: standard_models/historical_employees.py
 */

import { z } from 'zod'

export const HistoricalEmployeesQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
})
export type HistoricalEmployeesQueryParams = z.infer<typeof HistoricalEmployeesQueryParamsSchema>

export const HistoricalEmployeesDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  symbol: z.string().nullable().default(null).describe('Symbol representing the entity.'),
  employees: z.number().describe('Number of employees.'),
}).passthrough()
export type HistoricalEmployeesData = z.infer<typeof HistoricalEmployeesDataSchema>
