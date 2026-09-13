/**
 * ETF Info Standard Model.
 * Maps to: standard_models/etf_info.py
 */

import { z } from 'zod'

export const EtfInfoQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})
export type EtfInfoQueryParams = z.infer<typeof EtfInfoQueryParamsSchema>

export const EtfInfoDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  name: z.string().nullable().default(null).describe('Name of the ETF.'),
  issuer: z.string().nullable().default(null).describe('Company of the ETF.'),
  domicile: z.string().nullable().default(null).describe('Domicile of the ETF.'),
  website: z.string().nullable().default(null).describe('Website of the ETF.'),
  description: z.string().nullable().default(null).describe('Description of the ETF.'),
  inception_date: z.string().nullable().default(null).describe('Inception date of the ETF.'),
}).passthrough()
export type EtfInfoData = z.infer<typeof EtfInfoDataSchema>
