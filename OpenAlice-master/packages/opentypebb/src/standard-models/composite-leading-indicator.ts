/**
 * Composite Leading Indicator Standard Model.
 * Maps to: openbb_core/provider/standard_models/composite_leading_indicator.py
 */

import { z } from 'zod'

export const CompositeLeadingIndicatorQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
}).passthrough()

export type CompositeLeadingIndicatorQueryParams = z.infer<typeof CompositeLeadingIndicatorQueryParamsSchema>

export const CompositeLeadingIndicatorDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  value: z.number().nullable().default(null).describe('CLI value.'),
  country: z.string().describe('Country for the CLI value.'),
}).passthrough()

export type CompositeLeadingIndicatorData = z.infer<typeof CompositeLeadingIndicatorDataSchema>
