/**
 * Petroleum Status Report Standard Model.
 * Data from EIA Weekly Petroleum Status Report.
 */

import { z } from 'zod'

export const PetroleumStatusReportQueryParamsSchema = z.object({
  category: z.enum([
    'crude_oil_production',
    'crude_oil_stocks',
    'gasoline_stocks',
    'distillate_stocks',
    'refinery_utilization',
  ]).default('crude_oil_stocks').describe('Petroleum data category.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type PetroleumStatusReportQueryParams = z.infer<typeof PetroleumStatusReportQueryParamsSchema>

export const PetroleumStatusReportDataSchema = z.object({
  date: z.string().describe('Observation date.'),
  value: z.number().nullable().default(null).describe('Observation value.'),
  category: z.string().nullable().default(null).describe('Data category.'),
  unit: z.string().nullable().default(null).describe('Unit of measurement.'),
}).passthrough()

export type PetroleumStatusReportData = z.infer<typeof PetroleumStatusReportDataSchema>
