/**
 * FMP World News Model.
 * Maps to: openbb_fmp/models/world_news.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { WorldNewsQueryParamsSchema, WorldNewsDataSchema } from '../../../standard-models/world-news.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPWorldNewsQueryParamsSchema = WorldNewsQueryParamsSchema.extend({
  topic: z.enum(['fmp_articles', 'general', 'press_releases', 'stocks', 'forex', 'crypto']).default('general').describe('The topic of the news to be fetched.'),
  page: z.number().int().min(0).max(100).nullable().default(null).describe('Page number of the results.'),
})

export type FMPWorldNewsQueryParams = z.infer<typeof FMPWorldNewsQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  date: 'publishedDate',
  images: 'image',
  excerpt: 'text',
  source: 'site',
  author: 'publisher',
  symbols: 'symbol',
}

export const FMPWorldNewsDataSchema = WorldNewsDataSchema.extend({
  source: z.string().describe('News source.'),
}).passthrough()

export type FMPWorldNewsData = z.infer<typeof FMPWorldNewsDataSchema>

// --- Fetcher ---

export class FMPWorldNewsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPWorldNewsQueryParams {
    return FMPWorldNewsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPWorldNewsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const baseUrl = 'https://financialmodelingprep.com/stable/'
    let url: string

    if (query.topic === 'fmp_articles') {
      url = `${baseUrl}news/fmp-articles?page=${query.page ?? 0}&limit=${query.limit ?? 20}&apikey=${apiKey}`
    } else {
      const topicPath = query.topic.replace(/_/g, '-')
      url = `${baseUrl}news/${topicPath}-latest?from=${query.start_date ?? ''}&to=${query.end_date ?? ''}&limit=${query.limit ?? 250}&page=${query.page ?? 0}&apikey=${apiKey}`
    }

    const results = await getDataMany(url)

    return results.sort((a, b) =>
      String(b.publishedDate ?? '').localeCompare(String(a.publishedDate ?? '')),
    )
  }

  static override transformData(
    query: FMPWorldNewsQueryParams,
    data: Record<string, unknown>[],
  ): FMPWorldNewsData[] {
    if (!data || data.length === 0) {
      throw new EmptyDataError('No data was returned from FMP query.')
    }
    return data.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPWorldNewsDataSchema.parse(aliased)
    })
  }
}
