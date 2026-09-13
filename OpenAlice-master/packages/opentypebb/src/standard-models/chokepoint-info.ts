/**
 * Chokepoint Info Standard Model (Stub).
 */

import { z } from 'zod'

export const ChokepointInfoQueryParamsSchema = z.object({
  chokepoint: z.string().default('').describe('Chokepoint name (e.g., "Suez Canal", "Strait of Hormuz").'),
}).passthrough()

export type ChokepointInfoQueryParams = z.infer<typeof ChokepointInfoQueryParamsSchema>

export const ChokepointInfoDataSchema = z.object({
  name: z.string().nullable().default(null).describe('Chokepoint name.'),
  region: z.string().nullable().default(null).describe('Geographic region.'),
  latitude: z.number().nullable().default(null).describe('Latitude.'),
  longitude: z.number().nullable().default(null).describe('Longitude.'),
  description: z.string().nullable().default(null).describe('Description.'),
}).passthrough()

export type ChokepointInfoData = z.infer<typeof ChokepointInfoDataSchema>
