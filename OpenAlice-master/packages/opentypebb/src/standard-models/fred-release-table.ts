/**
 * FRED Release Table Standard Model.
 * Maps to: openbb_core/provider/standard_models/fred_release_table.py
 */

import { z } from 'zod'

export const FredReleaseTableQueryParamsSchema = z.object({
  release_id: z.string().describe('FRED release ID.'),
  element_id: z.number().nullable().default(null).describe('Element ID within release.'),
  date: z.string().nullable().default(null).describe('Observation date in YYYY-MM-DD.'),
}).passthrough()

export type FredReleaseTableQueryParams = z.infer<typeof FredReleaseTableQueryParamsSchema>

export const FredReleaseTableDataSchema = z.object({
  element_id: z.number().nullable().default(null).describe('Element ID.'),
  name: z.string().nullable().default(null).describe('Element name.'),
  level: z.string().nullable().default(null).describe('Element level.'),
  value: z.string().nullable().default(null).describe('Observation value.'),
}).passthrough()

export type FredReleaseTableData = z.infer<typeof FredReleaseTableDataSchema>
