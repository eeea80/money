/**
 * FMP Crypto Search Model.
 * Maps to: openbb_fmp/models/crypto_search.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CryptoSearchQueryParamsSchema, CryptoSearchDataSchema } from '../../../standard-models/crypto-search.js'
import { getDataMany } from '../utils/helpers.js'

export const FMPCryptoSearchQueryParamsSchema = CryptoSearchQueryParamsSchema
export type FMPCryptoSearchQueryParams = z.infer<typeof FMPCryptoSearchQueryParamsSchema>

export const FMPCryptoSearchDataSchema = CryptoSearchDataSchema.extend({
  exchange: z.string().nullable().default(null).describe('The exchange code the crypto trades on.'),
}).passthrough()
export type FMPCryptoSearchData = z.infer<typeof FMPCryptoSearchDataSchema>

export class FMPCryptoSearchFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPCryptoSearchQueryParams {
    // Remove dashes from query
    if (typeof params.query === 'string') {
      params.query = params.query.replace(/-/g, '')
    }
    return FMPCryptoSearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPCryptoSearchQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(`https://financialmodelingprep.com/stable/cryptocurrency-list?apikey=${apiKey}`)
  }

  static override transformData(
    query: FMPCryptoSearchQueryParams,
    data: Record<string, unknown>[],
  ): FMPCryptoSearchData[] {
    let filtered = data
    if (query.query) {
      const q = query.query.toLowerCase()
      filtered = data.filter((d) =>
        String(d.symbol ?? '').toLowerCase().includes(q) ||
        String(d.name ?? '').toLowerCase().includes(q) ||
        String(d.exchange ?? '').toLowerCase().includes(q),
      )
    }
    return filtered.map((d) => FMPCryptoSearchDataSchema.parse(d))
  }
}
