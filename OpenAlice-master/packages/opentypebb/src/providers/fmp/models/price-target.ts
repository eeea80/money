/**
 * FMP Price Target Model.
 * Maps to: openbb_fmp/models/price_target.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { PriceTargetQueryParamsSchema, PriceTargetDataSchema } from '../../../standard-models/price-target.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPPriceTargetQueryParamsSchema = PriceTargetQueryParamsSchema.extend({})
export type FMPPriceTargetQueryParams = z.infer<typeof FMPPriceTargetQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  analyst_firm: 'analystCompany',
  rating_current: 'newGrade',
  rating_previous: 'previousGrade',
  news_title: 'newsTitle',
  news_url: 'newsURL',
}

export const FMPPriceTargetDataSchema = PriceTargetDataSchema.extend({
  news_title: z.string().nullable().default(null).describe('Title of the associated news.'),
  news_url: z.string().nullable().default(null).describe('URL of the associated news.'),
}).passthrough()

export type FMPPriceTargetData = z.infer<typeof FMPPriceTargetDataSchema>

// --- Fetcher ---

export class FMPPriceTargetFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPPriceTargetQueryParams {
    return FMPPriceTargetQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPPriceTargetQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const url = 'https://financialmodelingprep.com/stable/price-target'
      + `?symbol=${query.symbol}`
      + (query.limit ? `&limit=${query.limit}` : '')
      + `&apikey=${apiKey}`
    return getDataMany(url)
  }

  static override transformData(
    query: FMPPriceTargetQueryParams,
    data: Record<string, unknown>[],
  ): FMPPriceTargetData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPPriceTargetDataSchema.parse(aliased)
    })
  }
}
