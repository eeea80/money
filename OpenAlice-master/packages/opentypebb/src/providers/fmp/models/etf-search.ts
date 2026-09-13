/**
 * FMP ETF Search Model.
 * Maps to: openbb_fmp/models/etf_search.py
 *
 * Uses the company-screener endpoint filtered to ETFs only,
 * matching the Python implementation.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EtfSearchQueryParamsSchema, EtfSearchDataSchema } from '../../../standard-models/etf-search.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  name: 'companyName',
  market_cap: 'marketCap',
  last_annual_dividend: 'lastAnnualDividend',
  exchange: 'exchangeShortName',
  exchange_name: 'exchange',
}

const numOrNull = z.number().nullable().default(null)

export const FMPEtfSearchQueryParamsSchema = EtfSearchQueryParamsSchema.extend({
  exchange: z.string().nullable().default(null).describe('The exchange code the ETF is listed on.'),
  is_active: z.boolean().default(true).describe('Whether the ETF is actively trading.'),
})
export type FMPEtfSearchQueryParams = z.infer<typeof FMPEtfSearchQueryParamsSchema>

export const FMPEtfSearchDataSchema = EtfSearchDataSchema.extend({
  market_cap: numOrNull.describe('The market cap of the ETF.'),
  sector: z.string().nullable().default(null).describe('The sector of the ETF.'),
  industry: z.string().nullable().default(null).describe('The industry of the ETF.'),
  beta: numOrNull.describe('The beta of the ETF.'),
  price: numOrNull.describe('The current price of the ETF.'),
  last_annual_dividend: numOrNull.describe('The last annual dividend of the ETF.'),
  volume: numOrNull.describe('The current volume of the ETF.'),
  exchange: z.string().nullable().default(null).describe('The exchange the ETF is listed on.'),
  exchange_name: z.string().nullable().default(null).describe('The name of the exchange.'),
  country: z.string().nullable().default(null).describe('The country of the ETF.'),
}).passthrough()
export type FMPEtfSearchData = z.infer<typeof FMPEtfSearchDataSchema>

export class FMPEtfSearchFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEtfSearchQueryParams {
    return FMPEtfSearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEtfSearchQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    let url = `https://financialmodelingprep.com/stable/company-screener?isEtf=true&isFund=false&isActivelyTrading=${query.is_active}&apikey=${apiKey}`
    if (query.query) url += `&query=${encodeURIComponent(query.query)}`
    if (query.exchange) url += `&exchange=${encodeURIComponent(query.exchange)}`
    return getDataMany(url)
  }

  static override transformData(
    _query: FMPEtfSearchQueryParams,
    data: Record<string, unknown>[],
  ): FMPEtfSearchData[] {
    return data.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPEtfSearchDataSchema.parse(aliased)
    })
  }
}
