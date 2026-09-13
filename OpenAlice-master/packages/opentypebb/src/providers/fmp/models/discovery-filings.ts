/**
 * FMP Discovery Filings Model.
 * Maps to: openbb_fmp/models/discovery_filings.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { DiscoveryFilingsQueryParamsSchema, DiscoveryFilingsDataSchema } from '../../../standard-models/discovery-filings.js'
import { getDataMany } from '../utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'

export const FMPDiscoveryFilingsQueryParamsSchema = DiscoveryFilingsQueryParamsSchema.extend({
  limit: z.coerce.number().nullable().default(null).describe('The maximum number of results to return. Default is 10000.'),
})
export type FMPDiscoveryFilingsQueryParams = z.infer<typeof FMPDiscoveryFilingsQueryParamsSchema>

export const FMPDiscoveryFilingsDataSchema = DiscoveryFilingsDataSchema.extend({
  final_link: z.string().nullable().default(null).describe('Direct URL to the main document of the filing.'),
}).passthrough()
export type FMPDiscoveryFilingsData = z.infer<typeof FMPDiscoveryFilingsDataSchema>

export class FMPDiscoveryFilingsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPDiscoveryFilingsQueryParams {
    return FMPDiscoveryFilingsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPDiscoveryFilingsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const limit = query.limit ?? 10000

    const now = new Date()
    const startDate = query.start_date ??
      new Date(now.getTime() - (query.form_type ? 89 : 2) * 86400000).toISOString().split('T')[0]
    const endDate = query.end_date ?? now.toISOString().split('T')[0]

    const baseUrl = query.form_type
      ? 'https://financialmodelingprep.com/stable/sec-filings-search/form-type'
      : 'https://financialmodelingprep.com/stable/sec-filings-financials/'

    const qs = new URLSearchParams()
    qs.set('from', startDate)
    qs.set('to', endDate)
    if (query.form_type) qs.set('formType', query.form_type)
    qs.set('apikey', apiKey)

    // FMP only allows 1000 results per page
    const pages = Math.ceil(limit / 1000)
    const allResults: Record<string, unknown>[] = []

    for (let page = 0; page < pages; page++) {
      try {
        const data = await getDataMany(
          `${baseUrl}?${qs.toString()}&page=${page}&limit=1000`,
        )
        allResults.push(...data)
        // If we got fewer than 1000, no more pages
        if (data.length < 1000) break
      } catch {
        // Stop paginating on error (e.g., empty page)
        break
      }
    }

    return allResults.sort((a, b) =>
      String(b.acceptedDate ?? '').localeCompare(String(a.acceptedDate ?? '')),
    )
  }

  static override transformData(
    _query: FMPDiscoveryFilingsQueryParams,
    data: Record<string, unknown>[],
  ): FMPDiscoveryFilingsData[] {
    if (!data || data.length === 0) {
      throw new EmptyDataError('No data was returned for the given query.')
    }
    return data.map(d => FMPDiscoveryFilingsDataSchema.parse(d))
  }
}
