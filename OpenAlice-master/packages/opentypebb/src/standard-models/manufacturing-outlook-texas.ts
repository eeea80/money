/**
 * Dallas Fed Manufacturing Outlook Standard Model.
 * Maps to: openbb_core/provider/standard_models/manufacturing_outlook_texas.py
 */

import { z } from 'zod'

export const ManufacturingOutlookTexasQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type ManufacturingOutlookTexasQueryParams = z.infer<typeof ManufacturingOutlookTexasQueryParamsSchema>

export const ManufacturingOutlookTexasDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  general_activity: z.number().nullable().default(null).describe('General business activity index.'),
  production: z.number().nullable().default(null).describe('Production index.'),
  new_orders: z.number().nullable().default(null).describe('New orders index.'),
}).passthrough()

export type ManufacturingOutlookTexasData = z.infer<typeof ManufacturingOutlookTexasDataSchema>
