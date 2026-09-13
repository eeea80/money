/**
 * Discovery Filings Standard Model.
 * Maps to: openbb_core/provider/standard_models/discovery_filings.py
 */

import { z } from 'zod'

export const DiscoveryFilingsQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
  form_type: z.string().nullable().default(null).describe('Filter by form type.'),
  limit: z.coerce.number().nullable().default(null).describe('The number of data entries to return.'),
}).passthrough()

export type DiscoveryFilingsQueryParams = z.infer<typeof DiscoveryFilingsQueryParamsSchema>

export const DiscoveryFilingsDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  cik: z.string().describe('CIK number.'),
  filing_date: z.string().describe('The filing date.'),
  accepted_date: z.string().describe('The accepted date.'),
  form_type: z.string().describe('The form type of the filing.'),
  link: z.string().describe('URL to the filing page on the SEC site.'),
}).passthrough()

export type DiscoveryFilingsData = z.infer<typeof DiscoveryFilingsDataSchema>
