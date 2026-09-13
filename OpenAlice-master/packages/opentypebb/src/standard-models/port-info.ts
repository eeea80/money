/**
 * Port Info Standard Model (Stub).
 */

import { z } from 'zod'

export const PortInfoQueryParamsSchema = z.object({
  port: z.string().default('').describe('Port code or name.'),
}).passthrough()

export type PortInfoQueryParams = z.infer<typeof PortInfoQueryParamsSchema>

export const PortInfoDataSchema = z.object({
  port_code: z.string().nullable().default(null).describe('Port code.'),
  port_name: z.string().nullable().default(null).describe('Port name.'),
  country: z.string().nullable().default(null).describe('Country.'),
  latitude: z.number().nullable().default(null).describe('Latitude.'),
  longitude: z.number().nullable().default(null).describe('Longitude.'),
}).passthrough()

export type PortInfoData = z.infer<typeof PortInfoDataSchema>
