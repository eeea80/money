/**
 * Index Constituents Standard Model.
 * Maps to: openbb_core/provider/standard_models/index_constituents.py
 */

import { z } from 'zod'

export const IndexConstituentsQueryParamsSchema = z.object({
  symbol: z.string().describe('Symbol to get data for.'),
}).passthrough()

export type IndexConstituentsQueryParams = z.infer<typeof IndexConstituentsQueryParamsSchema>

export const IndexConstituentsDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  name: z.string().nullable().default(null).describe('Name of the constituent company in the index.'),
}).passthrough()

export type IndexConstituentsData = z.infer<typeof IndexConstituentsDataSchema>
