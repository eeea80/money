/**
 * Chokepoint Volume Standard Model (Stub).
 */

import { z } from 'zod'

export const ChokepointVolumeQueryParamsSchema = z.object({
  chokepoint: z.string().default('').describe('Chokepoint name.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type ChokepointVolumeQueryParams = z.infer<typeof ChokepointVolumeQueryParamsSchema>

export const ChokepointVolumeDataSchema = z.object({
  date: z.string().describe('Observation date.'),
  chokepoint: z.string().nullable().default(null).describe('Chokepoint name.'),
  volume: z.number().nullable().default(null).describe('Transit volume.'),
  unit: z.string().nullable().default(null).describe('Unit of measurement.'),
}).passthrough()

export type ChokepointVolumeData = z.infer<typeof ChokepointVolumeDataSchema>
