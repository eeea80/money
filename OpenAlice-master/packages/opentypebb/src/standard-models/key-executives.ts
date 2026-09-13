/**
 * Key Executives Standard Model.
 * Maps to: standard_models/key_executives.py
 */

import { z } from 'zod'

export const KeyExecutivesQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})
export type KeyExecutivesQueryParams = z.infer<typeof KeyExecutivesQueryParamsSchema>

export const KeyExecutivesDataSchema = z.object({
  title: z.string().describe('Designation of the key executive.'),
  name: z.string().describe('Name of the key executive.'),
  pay: z.number().nullable().default(null).describe('Pay of the key executive.'),
  currency_pay: z.string().nullable().default(null).describe('Currency of the pay.'),
  gender: z.string().nullable().default(null).describe('Gender of the key executive.'),
  year_born: z.number().nullable().default(null).describe('Birth year of the key executive.'),
}).passthrough()
export type KeyExecutivesData = z.infer<typeof KeyExecutivesDataSchema>
