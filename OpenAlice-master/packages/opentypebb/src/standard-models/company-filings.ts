/**
 * Company Filings Standard Model.
 * Maps to: standard_models/company_filings.py
 */

import { z } from 'zod'

export const CompanyFilingsQueryParamsSchema = z.object({
  symbol: z.string().nullable().default(null).transform(v => v ? v.toUpperCase() : null).describe('Symbol to get data for.'),
})
export type CompanyFilingsQueryParams = z.infer<typeof CompanyFilingsQueryParamsSchema>

export const CompanyFilingsDataSchema = z.object({
  filing_date: z.string().describe('The date of the filing.'),
  report_type: z.string().nullable().default(null).describe('Type of filing.'),
  report_url: z.string().describe('URL to the filing.'),
}).passthrough()
export type CompanyFilingsData = z.infer<typeof CompanyFilingsDataSchema>
