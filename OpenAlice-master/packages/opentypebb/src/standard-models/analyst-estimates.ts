/**
 * Analyst Estimates Standard Model.
 * Maps to: standard_models/analyst_estimates.py
 */

import { z } from 'zod'

// --- Query Params ---

export const AnalystEstimatesQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})

export type AnalystEstimatesQueryParams = z.infer<typeof AnalystEstimatesQueryParamsSchema>

// --- Data ---

export const AnalystEstimatesDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  date: z.string().describe('The date of the data.'),
  estimated_revenue_low: z.number().nullable().default(null).describe('Estimated revenue low.'),
  estimated_revenue_high: z.number().nullable().default(null).describe('Estimated revenue high.'),
  estimated_revenue_avg: z.number().nullable().default(null).describe('Estimated revenue average.'),
  estimated_sga_expense_low: z.number().nullable().default(null).describe('Estimated SGA expense low.'),
  estimated_sga_expense_high: z.number().nullable().default(null).describe('Estimated SGA expense high.'),
  estimated_sga_expense_avg: z.number().nullable().default(null).describe('Estimated SGA expense average.'),
  estimated_ebitda_low: z.number().nullable().default(null).describe('Estimated EBITDA low.'),
  estimated_ebitda_high: z.number().nullable().default(null).describe('Estimated EBITDA high.'),
  estimated_ebitda_avg: z.number().nullable().default(null).describe('Estimated EBITDA average.'),
  estimated_ebit_low: z.number().nullable().default(null).describe('Estimated EBIT low.'),
  estimated_ebit_high: z.number().nullable().default(null).describe('Estimated EBIT high.'),
  estimated_ebit_avg: z.number().nullable().default(null).describe('Estimated EBIT average.'),
  estimated_net_income_low: z.number().nullable().default(null).describe('Estimated net income low.'),
  estimated_net_income_high: z.number().nullable().default(null).describe('Estimated net income high.'),
  estimated_net_income_avg: z.number().nullable().default(null).describe('Estimated net income average.'),
  estimated_eps_low: z.number().nullable().default(null).describe('Estimated EPS low.'),
  estimated_eps_high: z.number().nullable().default(null).describe('Estimated EPS high.'),
  estimated_eps_avg: z.number().nullable().default(null).describe('Estimated EPS average.'),
  number_analyst_estimated_revenue: z.number().nullable().default(null).describe('Number of analysts estimating revenue.'),
  number_analysts_estimated_eps: z.number().nullable().default(null).describe('Number of analysts estimating EPS.'),
}).passthrough()

export type AnalystEstimatesData = z.infer<typeof AnalystEstimatesDataSchema>
