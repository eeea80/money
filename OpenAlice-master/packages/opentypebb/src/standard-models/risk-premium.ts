/**
 * Risk Premium Standard Model.
 * Maps to: openbb_core/provider/standard_models/risk_premium.py
 */

import { z } from 'zod'

export const RiskPremiumQueryParamsSchema = z.object({}).passthrough()

export type RiskPremiumQueryParams = z.infer<typeof RiskPremiumQueryParamsSchema>

export const RiskPremiumDataSchema = z.object({
  country: z.string().describe('Market country.'),
  continent: z.string().nullable().default(null).describe('Continent of the country.'),
  total_equity_risk_premium: z.number().nullable().default(null).describe('Total equity risk premium for the country.'),
  country_risk_premium: z.number().nullable().default(null).describe('Country-specific risk premium.'),
}).passthrough()

export type RiskPremiumData = z.infer<typeof RiskPremiumDataSchema>
