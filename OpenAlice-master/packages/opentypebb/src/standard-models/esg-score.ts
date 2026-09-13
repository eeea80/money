/**
 * ESG Score Standard Model.
 * Maps to: openbb_core/provider/standard_models/esg.py
 */

import { z } from 'zod'

const numOrNull = z.number().nullable().default(null)

export const EsgScoreQueryParamsSchema = z.object({
  symbol: z.string().describe('Symbol to get data for.'),
}).passthrough()

export type EsgScoreQueryParams = z.infer<typeof EsgScoreQueryParamsSchema>

export const EsgScoreDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  cik: z.string().nullable().default(null).describe('CIK number.'),
  company_name: z.string().nullable().default(null).describe('Company name.'),
  form_type: z.string().nullable().default(null).describe('Form type.'),
  accepted_date: z.string().nullable().default(null).describe('Accepted date.'),
  date: z.string().nullable().default(null).describe('The date of the data.'),
  environmental_score: numOrNull.describe('Environmental score.'),
  social_score: numOrNull.describe('Social score.'),
  governance_score: numOrNull.describe('Governance score.'),
  esg_score: numOrNull.describe('ESG score.'),
  url: z.string().nullable().default(null).describe('URL to the filing.'),
}).passthrough()

export type EsgScoreData = z.infer<typeof EsgScoreDataSchema>
