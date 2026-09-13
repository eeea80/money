/**
 * Forward EPS Estimates Standard Model.
 * Maps to: standard_models/forward_eps_estimates.py
 */

import { z } from 'zod'

// --- Query Params ---

export const ForwardEpsEstimatesQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})

export type ForwardEpsEstimatesQueryParams = z.infer<typeof ForwardEpsEstimatesQueryParamsSchema>

// --- Data ---

export const ForwardEpsEstimatesDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  name: z.string().nullable().default(null).describe('Name of the entity.'),
  date: z.string().nullable().default(null).describe('The date of the data.'),
  fiscal_year: z.number().nullable().default(null).describe('Fiscal year for the estimate.'),
  fiscal_period: z.string().nullable().default(null).describe('Fiscal period for the estimate.'),
  calendar_year: z.number().nullable().default(null).describe('Calendar year for the estimate.'),
  calendar_period: z.string().nullable().default(null).describe('Calendar period for the estimate.'),
  low_estimate: z.number().nullable().default(null).describe('Low analyst estimate.'),
  high_estimate: z.number().nullable().default(null).describe('High analyst estimate.'),
  mean: z.number().nullable().default(null).describe('Mean analyst estimate.'),
  median: z.number().nullable().default(null).describe('Median analyst estimate.'),
  standard_deviation: z.number().nullable().default(null).describe('Standard deviation of estimates.'),
  number_of_analysts: z.number().nullable().default(null).describe('Number of analysts providing estimates.'),
}).passthrough()

export type ForwardEpsEstimatesData = z.infer<typeof ForwardEpsEstimatesDataSchema>
