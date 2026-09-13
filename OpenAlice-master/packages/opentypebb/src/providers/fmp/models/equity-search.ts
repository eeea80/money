/**
 * FMP Equity Search Model.
 *
 * Uses FMP's /stable/search-name endpoint to search equities by name or symbol.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquitySearchQueryParamsSchema, EquitySearchDataSchema } from '../../../standard-models/equity-search.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { responseCallback } from '../utils/helpers.js'

export const FMPEquitySearchQueryParamsSchema = EquitySearchQueryParamsSchema
export type FMPEquitySearchQueryParams = z.infer<typeof FMPEquitySearchQueryParamsSchema>

export const FMPEquitySearchDataSchema = EquitySearchDataSchema.extend({
  currency: z.string().nullable().default(null).describe('Currency the equity trades in.'),
  exchange: z.string().nullable().default(null).describe('Exchange code.'),
  exchange_name: z.string().nullable().default(null).describe('Full exchange name.'),
}).passthrough()
export type FMPEquitySearchData = z.infer<typeof FMPEquitySearchDataSchema>

const ALIAS_DICT: Record<string, string> = {
  exchange_name: 'exchangeFullName',
}

export class FMPEquitySearchFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEquitySearchQueryParams {
    return FMPEquitySearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEquitySearchQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const q = encodeURIComponent(query.query)
    const url = `https://financialmodelingprep.com/stable/search-name?query=${q}&apikey=${apiKey}`
    return amakeRequest<Record<string, unknown>[]>(url, { responseCallback })
  }

  static override transformData(
    query: FMPEquitySearchQueryParams,
    data: Record<string, unknown>[],
  ): FMPEquitySearchData[] {
    if (!data || data.length === 0) {
      throw new EmptyDataError('No results found for the search query.')
    }
    return data.map((d) => {
      // Alias exchangeFullName → exchange_name
      if (d.exchangeFullName && !d.exchange_name) {
        d.exchange_name = d.exchangeFullName
        delete d.exchangeFullName
      }
      return FMPEquitySearchDataSchema.parse(d)
    })
  }
}
