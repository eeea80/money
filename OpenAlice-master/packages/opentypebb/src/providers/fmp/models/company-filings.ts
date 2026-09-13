/**
 * FMP Company Filings Model.
 * Maps to: openbb_fmp/models/company_filings.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CompanyFilingsQueryParamsSchema, CompanyFilingsDataSchema } from '../../../standard-models/company-filings.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  accepted_date: 'acceptedDate',
  report_type: 'formType',
  filing_url: 'link',
  report_url: 'finalLink',
}

export const FMPCompanyFilingsQueryParamsSchema = CompanyFilingsQueryParamsSchema.extend({
  cik: z.string().nullable().default(null).describe('CIK number.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
  limit: z.coerce.number().default(1000).describe('The number of data entries to return (max 1000).'),
  page: z.coerce.number().default(0).describe('Page number for pagination.'),
})
export type FMPCompanyFilingsQueryParams = z.infer<typeof FMPCompanyFilingsQueryParamsSchema>

export const FMPCompanyFilingsDataSchema = CompanyFilingsDataSchema.extend({
  filing_url: z.string().nullable().default(null).describe('URL to the filing document.'),
  symbol: z.string().nullable().default(null).describe('Symbol.'),
  cik: z.string().nullable().default(null).describe('CIK number.'),
  accepted_date: z.string().nullable().default(null).describe('Date the filing was accepted.'),
}).passthrough()
export type FMPCompanyFilingsData = z.infer<typeof FMPCompanyFilingsDataSchema>

export class FMPCompanyFilingsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPCompanyFilingsQueryParams {
    return FMPCompanyFilingsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPCompanyFilingsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const qs = new URLSearchParams()
    qs.set('apikey', apiKey)
    qs.set('limit', String(Math.min(query.limit, 1000)))
    qs.set('page', String(query.page))

    if (query.start_date) qs.set('from', query.start_date)
    if (query.end_date) qs.set('to', query.end_date)

    let endpoint: string
    if (query.symbol) {
      qs.set('symbol', query.symbol)
      endpoint = 'sec-filings-search/symbol'
    } else if (query.cik) {
      qs.set('cik', query.cik)
      endpoint = 'sec-filings-search/cik'
    } else {
      endpoint = 'sec-filings-search/symbol'
    }

    return getDataMany(
      `https://financialmodelingprep.com/stable/${endpoint}?${qs.toString()}`,
    )
  }

  static override transformData(
    _query: FMPCompanyFilingsQueryParams,
    data: Record<string, unknown>[],
  ): FMPCompanyFilingsData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPCompanyFilingsDataSchema.parse(aliased)
    })
  }
}
