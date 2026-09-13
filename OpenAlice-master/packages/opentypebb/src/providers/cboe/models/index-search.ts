/**
 * CBOE Index Search Model.
 * Maps to: openbb_cboe/models/index_search.py
 *
 * Fetches the CBOE index directory and filters by query.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { IndexSearchDataSchema } from '../../../standard-models/index-search.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { nativeFetch } from '../../../core/provider/utils/helpers.js'

const CBOE_INDEX_DIRECTORY_URL = 'https://www.cboe.com/us/indices/index-directory/'

export const CboeIndexSearchQueryParamsSchema = z.object({
  query: z.string().default('').describe('Search query.'),
  is_symbol: z.boolean().default(false).describe('Whether to search by ticker symbol.'),
}).passthrough()

export type CboeIndexSearchQueryParams = z.infer<typeof CboeIndexSearchQueryParamsSchema>

export const CboeIndexSearchDataSchema = IndexSearchDataSchema.extend({
  description: z.string().nullable().default(null).describe('Description for the index.'),
  currency: z.string().nullable().default(null).describe('Currency for the index.'),
  time_zone: z.string().nullable().default(null).describe('Time zone for the index.'),
}).passthrough()

export type CboeIndexSearchData = z.infer<typeof CboeIndexSearchDataSchema>

// Cache for the CBOE index directory
let _cachedDirectory: Record<string, unknown>[] | null = null
let _cacheTime = 0
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

async function getIndexDirectory(): Promise<Record<string, unknown>[]> {
  const now = Date.now()
  if (_cachedDirectory && (now - _cacheTime) < CACHE_TTL) {
    return _cachedDirectory
  }

  // CBOE provides index directory as JSON from their API
  const url = 'https://www.cboe.com/us/indices/api/index-directory/'
  try {
    const resp = await nativeFetch(url, { timeoutMs: 30000 })
    if (resp.status === 200) {
      const data = JSON.parse(resp.text) as Record<string, unknown>[]
      if (Array.isArray(data) && data.length > 0) {
        _cachedDirectory = data
        _cacheTime = now
        return data
      }
    }
  } catch { /* fall through */ }

  // Fallback: try the main endpoint with a different format
  try {
    const resp = await nativeFetch('https://cdn.cboe.com/api/global/us_indices/definitions/all_indices.json', { timeoutMs: 30000 })
    if (resp.status === 200) {
      const json = JSON.parse(resp.text) as { data?: Record<string, unknown>[] }
      const records = json.data ?? (Array.isArray(json) ? json : [])
      if (Array.isArray(records) && records.length > 0) {
        _cachedDirectory = records as Record<string, unknown>[]
        _cacheTime = now
        return _cachedDirectory
      }
    }
  } catch { /* fall through */ }

  throw new EmptyDataError('Failed to fetch CBOE index directory.')
}

export class CboeIndexSearchFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): CboeIndexSearchQueryParams {
    return CboeIndexSearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: CboeIndexSearchQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const directory = await getIndexDirectory()

    if (!query.query) return directory

    const q = query.query.toLowerCase()

    if (query.is_symbol) {
      return directory.filter(d => {
        const sym = String(d.index_symbol ?? d.symbol ?? '').toLowerCase()
        return sym.includes(q)
      })
    }

    return directory.filter(d => {
      const sym = String(d.index_symbol ?? d.symbol ?? '').toLowerCase()
      const name = String(d.name ?? '').toLowerCase()
      const desc = String(d.description ?? '').toLowerCase()
      return sym.includes(q) || name.includes(q) || desc.includes(q)
    })
  }

  static override transformData(
    _query: CboeIndexSearchQueryParams,
    data: Record<string, unknown>[],
  ): CboeIndexSearchData[] {
    if (data.length === 0) throw new EmptyDataError('No matching indices found.')
    return data.map(d => CboeIndexSearchDataSchema.parse({
      symbol: d.index_symbol ?? d.symbol ?? '',
      name: d.name ?? '',
      description: d.description ?? null,
      currency: d.currency ?? null,
      time_zone: d.time_zone ?? null,
    }))
  }
}
