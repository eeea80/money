/**
 * SEC Equity Search Fetcher.
 *
 * Fetches the full company tickers list from SEC EDGAR (free, no API key).
 * Source: https://www.sec.gov/files/company_tickers.json
 *
 * The JSON is a dict keyed by index: { "0": { cik_str, ticker, title }, ... }
 * ~10,000 entries, sorted by market cap.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { EquitySearchQueryParamsSchema, EquitySearchDataSchema } from '../../../standard-models/equity-search.js'

// ==================== Provider-specific schemas ====================

export const SECEquitySearchQueryParamsSchema = EquitySearchQueryParamsSchema.extend({
  use_cache: z.boolean().default(true).describe('Whether to use the cache or not.'),
  is_fund: z.boolean().default(false).describe('Whether to search the mutual funds/ETFs list.'),
})

export type SECEquitySearchQueryParams = z.infer<typeof SECEquitySearchQueryParamsSchema>

export const SECEquitySearchDataSchema = EquitySearchDataSchema.extend({
  cik: z.string().describe('Central Index Key'),
})

export type SECEquitySearchData = z.infer<typeof SECEquitySearchDataSchema>

// ==================== Raw SEC JSON shape ====================

interface SECTickerEntry {
  cik_str: number
  ticker: string
  title: string
}

// ==================== Fetcher ====================

const SEC_URL = 'https://www.sec.gov/files/company_tickers.json'
const SEC_HEADERS = {
  'User-Agent': 'OpenTypeBB/1.0 contact@example.com',
  'Accept-Encoding': 'gzip, deflate',
}

export class SECEquitySearchFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): SECEquitySearchQueryParams {
    return SECEquitySearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    _query: SECEquitySearchQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<SECTickerEntry[]> {
    const raw = await amakeRequest<Record<string, SECTickerEntry>>(SEC_URL, {
      headers: SEC_HEADERS,
    })

    // raw is { "0": { cik_str, ticker, title }, "1": ... }
    return Object.values(raw)
  }

  static override transformData(
    query: SECEquitySearchQueryParams,
    data: SECTickerEntry[],
  ): SECEquitySearchData[] {
    const q = query.query.toLowerCase()

    // If empty query, return all (for bulk loading by SymbolIndex)
    const filtered = q
      ? data.filter((d) =>
          d.ticker.toLowerCase().includes(q) ||
          d.title.toLowerCase().includes(q) ||
          String(d.cik_str).includes(q),
        )
      : data

    return filtered.map((d) =>
      SECEquitySearchDataSchema.parse({
        symbol: d.ticker,
        name: d.title,
        cik: String(d.cik_str),
      }),
    )
  }
}
