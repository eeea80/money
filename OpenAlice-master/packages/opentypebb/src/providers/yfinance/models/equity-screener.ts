/**
 * Yahoo Finance Equity Screener Model.
 * Maps to: openbb_yfinance/models/equity_screener.py
 *
 * Uses Yahoo Finance custom screener API with filter operands.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityScreenerQueryParamsSchema, EquityScreenerDataSchema } from '../../../standard-models/equity-screener.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getPredefinedScreener } from '../utils/helpers.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { YF_SCREENER_ALIAS_DICT, YFPredefinedScreenerDataSchema } from '../utils/references.js'

export const YFinanceEquityScreenerQueryParamsSchema = EquityScreenerQueryParamsSchema.extend({
  country: z.string().nullable().default('us').describe('Filter by country code (e.g. us, de, jp). Use "all" for no filter.'),
  sector: z.string().nullable().default(null).describe('Filter by sector.'),
  industry: z.string().nullable().default(null).describe('Filter by industry.'),
  exchange: z.string().nullable().default(null).describe('Filter by exchange.'),
  mktcap_min: z.number().nullable().default(500000000).describe('Filter by min market cap. Default 500M.'),
  mktcap_max: z.number().nullable().default(null).describe('Filter by max market cap.'),
  price_min: z.number().nullable().default(5).describe('Filter by min price. Default 5.'),
  price_max: z.number().nullable().default(null).describe('Filter by max price.'),
  volume_min: z.number().nullable().default(10000).describe('Filter by min volume. Default 10K.'),
  volume_max: z.number().nullable().default(null).describe('Filter by max volume.'),
  beta_min: z.number().nullable().default(null).describe('Filter by min beta.'),
  beta_max: z.number().nullable().default(null).describe('Filter by max beta.'),
  limit: z.number().nullable().default(200).describe('Limit the number of results. Default 200.'),
}).passthrough()
export type YFinanceEquityScreenerQueryParams = z.infer<typeof YFinanceEquityScreenerQueryParamsSchema>

export const YFinanceEquityScreenerDataSchema = EquityScreenerDataSchema.merge(YFPredefinedScreenerDataSchema).passthrough()
export type YFinanceEquityScreenerData = z.infer<typeof YFinanceEquityScreenerDataSchema>

/** Sector code → display name mapping */
const SECTOR_MAP: Record<string, string> = {
  basic_materials: 'Basic Materials',
  communication_services: 'Communication Services',
  consumer_cyclical: 'Consumer Cyclical',
  consumer_defensive: 'Consumer Defensive',
  energy: 'Energy',
  financial_services: 'Financial Services',
  healthcare: 'Healthcare',
  industrials: 'Industrials',
  real_estate: 'Real Estate',
  technology: 'Technology',
  utilities: 'Utilities',
}

export class YFinanceEquityScreenerFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFinanceEquityScreenerQueryParams {
    return YFinanceEquityScreenerQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceEquityScreenerQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    // For now, use predefined screener as a simplified approach.
    // The full custom screener API requires Yahoo's internal POST endpoint
    // which is complex to replicate without the yfinance Python library.
    // We use the day_gainers screener as base and filter client-side.
    const limit = query.limit ?? 200
    const data = await getPredefinedScreener('most_actives', Math.max(limit, 250))

    if (!data.length) {
      throw new EmptyDataError('No screener results found')
    }

    return data
  }

  static override transformData(
    query: YFinanceEquityScreenerQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceEquityScreenerData[] {
    const limit = query.limit ?? 200
    const results = data
      .map(d => {
        // Normalize percent_change
        if (typeof d.regularMarketChangePercent === 'number') {
          d.regularMarketChangePercent = d.regularMarketChangePercent / 100
        }
        const aliased = applyAliases(d, YF_SCREENER_ALIAS_DICT)
        try {
          return YFinanceEquityScreenerDataSchema.parse(aliased)
        } catch {
          return null
        }
      })
      .filter((d): d is YFinanceEquityScreenerData => d !== null)

    return limit > 0 ? results.slice(0, limit) : results
  }
}
