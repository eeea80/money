/**
 * Yahoo Finance Crypto Search Model.
 * Maps to: openbb_yfinance/models/crypto_search.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CryptoSearchQueryParamsSchema, CryptoSearchDataSchema } from '../../../standard-models/crypto-search.js'
import { searchYahooFinance } from '../utils/helpers.js'

export const YFinanceCryptoSearchQueryParamsSchema = CryptoSearchQueryParamsSchema
export type YFinanceCryptoSearchQueryParams = z.infer<typeof YFinanceCryptoSearchQueryParamsSchema>

export const YFinanceCryptoSearchDataSchema = CryptoSearchDataSchema.extend({
  exchange: z.string().nullable().default(null).describe('The exchange the crypto trades on.'),
  quote_type: z.string().nullable().default(null).describe('The quote type of the asset.'),
}).passthrough()
export type YFinanceCryptoSearchData = z.infer<typeof YFinanceCryptoSearchDataSchema>

export class YFinanceCryptoSearchFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceCryptoSearchQueryParams {
    return YFinanceCryptoSearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceCryptoSearchQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    if (!query.query) return []

    const quotes = await searchYahooFinance(query.query)
    return quotes
      .filter((q: any) => q.quoteType === 'CRYPTOCURRENCY')
      .map((q: any) => ({
        symbol: (q.symbol ?? '').replace('-', ''),
        name: q.longname ?? q.shortname ?? null,
        exchange: q.exchDisp ?? null,
        quote_type: q.quoteType ?? null,
      }))
  }

  static override transformData(
    query: YFinanceCryptoSearchQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceCryptoSearchData[] {
    return data.map(d => YFinanceCryptoSearchDataSchema.parse(d))
  }
}
