/**
 * Institutional Ownership Standard Model.
 * Maps to: standard_models/institutional_ownership.py
 */

import { z } from 'zod'

export const InstitutionalOwnershipQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})
export type InstitutionalOwnershipQueryParams = z.infer<typeof InstitutionalOwnershipQueryParamsSchema>

export const InstitutionalOwnershipDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  cik: z.string().nullable().default(null).describe('CIK number.'),
  date: z.string().describe('The date of the data.'),
}).passthrough()
export type InstitutionalOwnershipData = z.infer<typeof InstitutionalOwnershipDataSchema>
