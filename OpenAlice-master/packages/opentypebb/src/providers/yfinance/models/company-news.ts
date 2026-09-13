/**
 * Yahoo Finance Company News Model.
 * Maps to: openbb_yfinance/models/company_news.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CompanyNewsQueryParamsSchema, CompanyNewsDataSchema } from '../../../standard-models/company-news.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getYahooNews } from '../utils/helpers.js'

export const YFinanceCompanyNewsQueryParamsSchema = CompanyNewsQueryParamsSchema
export type YFinanceCompanyNewsQueryParams = z.infer<typeof YFinanceCompanyNewsQueryParamsSchema>

export const YFinanceCompanyNewsDataSchema = CompanyNewsDataSchema.extend({
  source: z.string().nullable().default(null).describe('Source of the news article.'),
}).passthrough()
export type YFinanceCompanyNewsData = z.infer<typeof YFinanceCompanyNewsDataSchema>

export class YFinanceCompanyNewsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceCompanyNewsQueryParams {
    if (!params.symbol) throw new Error('Required field missing -> symbol')
    return YFinanceCompanyNewsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceCompanyNewsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbols = (query.symbol ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const results: Record<string, unknown>[] = []

    await Promise.allSettled(
      symbols.map(async (sym) => {
        try {
          const news = await getYahooNews(sym, 20)
          for (const item of news as any[]) {
            if (!item.title || !item.link) continue
            // yahoo-finance2 returns providerPublishTime as a Date object
            let date: string | null = null
            if (item.providerPublishTime) {
              if (item.providerPublishTime instanceof Date) {
                date = item.providerPublishTime.toISOString()
              } else if (typeof item.providerPublishTime === 'string') {
                date = item.providerPublishTime
              } else if (typeof item.providerPublishTime === 'number') {
                date = new Date(item.providerPublishTime * 1000).toISOString()
              }
            }
            results.push({
              symbol: sym,
              title: item.title,
              url: item.link,
              date,
              text: item.summary ?? '',
              source: item.publisher ?? null,
            })
          }
        } catch { /* skip failures */ }
      })
    )

    if (!results.length) throw new EmptyDataError('No news data returned')
    return results
  }

  static override transformData(
    query: YFinanceCompanyNewsQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceCompanyNewsData[] {
    return data.map(d => YFinanceCompanyNewsDataSchema.parse(d))
  }
}
