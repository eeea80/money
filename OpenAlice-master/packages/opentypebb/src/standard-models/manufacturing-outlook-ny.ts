/**
 * NY Fed Manufacturing Outlook Standard Model.
 * Maps to: openbb_core/provider/standard_models/manufacturing_outlook_ny.py
 */

import { z } from 'zod'

export const ManufacturingOutlookNYQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type ManufacturingOutlookNYQueryParams = z.infer<typeof ManufacturingOutlookNYQueryParamsSchema>

export const ManufacturingOutlookNYDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  general_business_conditions: z.number().nullable().default(null).describe('Empire State general business conditions index.'),
  new_orders: z.number().nullable().default(null).describe('New orders diffusion index.'),
  employees: z.number().nullable().default(null).describe('Number of employees diffusion index.'),
}).passthrough()

export type ManufacturingOutlookNYData = z.infer<typeof ManufacturingOutlookNYDataSchema>
