/**
 * FMP Company News Model.
 * Maps to: openbb_fmp/models/company_news.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CompanyNewsQueryParamsSchema, CompanyNewsDataSchema } from '../../../standard-models/company-news.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPCompanyNewsQueryParamsSchema = CompanyNewsQueryParamsSchema.extend({
  page: z.number().int().min(0).max(100).default(0).describe('Page number of the results.'),
  press_release: z.boolean().nullable().default(null).describe('When true, return only press releases.'),
})

export type FMPCompanyNewsQueryParams = z.infer<typeof FMPCompanyNewsQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  symbols: 'symbol',
  date: 'publishedDate',
  author: 'publisher',
  images: 'image',
  source: 'site',
  excerpt: 'text',
}

export const FMPCompanyNewsDataSchema = CompanyNewsDataSchema.extend({
  source: z.string().describe('Name of the news site.'),
}).passthrough()

export type FMPCompanyNewsData = z.infer<typeof FMPCompanyNewsDataSchema>

// --- Fetcher ---

export class FMPCompanyNewsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPCompanyNewsQueryParams {
    if (!params.symbol) {
      throw new Error('Required field missing -> symbol')
    }
    return FMPCompanyNewsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPCompanyNewsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const limit = query.limit ?? 250
    const page = query.page ?? 0
    let baseUrl = 'https://financialmodelingprep.com/stable/news/'

    if (query.press_release) {
      baseUrl += 'press-releases?'
    } else {
      baseUrl += 'stock?'
    }

    let url = baseUrl + `symbols=${query.symbol}`

    if (query.start_date) url += `&from=${query.start_date}`
    if (query.end_date) url += `&to=${query.end_date}`

    url += `&limit=${limit}&page=${page}&apikey=${apiKey}`

    const response = await getDataMany(url)

    if (!response || response.length === 0) {
      throw new EmptyDataError()
    }

    return response.sort((a, b) =>
      String(b.publishedDate ?? '').localeCompare(String(a.publishedDate ?? '')),
    )
  }

  static override transformData(
    query: FMPCompanyNewsQueryParams,
    data: Record<string, unknown>[],
  ): FMPCompanyNewsData[] {
    return data.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPCompanyNewsDataSchema.parse(aliased)
    })
  }
}
