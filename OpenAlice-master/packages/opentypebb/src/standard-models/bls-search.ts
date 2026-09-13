/**
 * BLS Search Standard Model.
 */

import { z } from 'zod'

export const BlsSearchQueryParamsSchema = z.object({
  query: z.string().describe('Search query for BLS series.'),
  limit: z.number().default(50).describe('Maximum number of results.'),
}).passthrough()

export type BlsSearchQueryParams = z.infer<typeof BlsSearchQueryParamsSchema>

export const BlsSearchDataSchema = z.object({
  series_id: z.string().describe('BLS series ID.'),
  title: z.string().nullable().default(null).describe('Series title.'),
  survey_abbreviation: z.string().nullable().default(null).describe('Survey abbreviation.'),
}).passthrough()

export type BlsSearchData = z.infer<typeof BlsSearchDataSchema>
