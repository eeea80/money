/**
 * Short-Term Energy Outlook Standard Model.
 * Data from EIA STEO reports.
 */

import { z } from 'zod'

export const ShortTermEnergyOutlookQueryParamsSchema = z.object({
  category: z.enum([
    'crude_oil_price',
    'gasoline_price',
    'natural_gas_price',
    'crude_oil_production',
    'petroleum_consumption',
  ]).default('crude_oil_price').describe('STEO data category.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type ShortTermEnergyOutlookQueryParams = z.infer<typeof ShortTermEnergyOutlookQueryParamsSchema>

export const ShortTermEnergyOutlookDataSchema = z.object({
  date: z.string().describe('Observation date.'),
  value: z.number().nullable().default(null).describe('Observation value.'),
  category: z.string().nullable().default(null).describe('Data category.'),
  unit: z.string().nullable().default(null).describe('Unit of measurement.'),
  forecast: z.boolean().nullable().default(null).describe('Whether this is a forecast value.'),
}).passthrough()

export type ShortTermEnergyOutlookData = z.infer<typeof ShortTermEnergyOutlookDataSchema>
