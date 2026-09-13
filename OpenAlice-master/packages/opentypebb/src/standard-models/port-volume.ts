/**
 * Port Volume Standard Model (Stub).
 */

import { z } from 'zod'

export const PortVolumeQueryParamsSchema = z.object({
  port: z.string().default('').describe('Port code or name.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type PortVolumeQueryParams = z.infer<typeof PortVolumeQueryParamsSchema>

export const PortVolumeDataSchema = z.object({
  date: z.string().describe('Observation date.'),
  port_code: z.string().nullable().default(null).describe('Port code.'),
  volume: z.number().nullable().default(null).describe('Shipping volume (TEUs).'),
}).passthrough()

export type PortVolumeData = z.infer<typeof PortVolumeDataSchema>
