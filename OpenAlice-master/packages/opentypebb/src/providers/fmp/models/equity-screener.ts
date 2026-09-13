/**
 * FMP Equity Screener Model.
 * Maps to: openbb_fmp/models/equity_screener.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityScreenerQueryParamsSchema, EquityScreenerDataSchema } from '../../../standard-models/equity-screener.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const DATA_ALIAS_DICT: Record<string, string> = {
  name: 'companyName',
  market_cap: 'marketCap',
  last_annual_dividend: 'lastAnnualDividend',
  exchange: 'exchangeShortName',
  exchange_name: 'exchange',
  is_etf: 'isEtf',
  actively_trading: 'isActivelyTrading',
}

const QUERY_ALIAS_DICT: Record<string, string> = {
  mktcap_min: 'marketCapMoreThan',
  mktcap_max: 'marketCapLowerThan',
  price_min: 'priceMoreThan',
  price_max: 'priceLowerThan',
  beta_min: 'betaMoreThan',
  beta_max: 'betaLowerThan',
  volume_min: 'volumeMoreThan',
  volume_max: 'volumeLowerThan',
  dividend_min: 'dividendMoreThan',
  dividend_max: 'dividendLowerThan',
  is_active: 'isActivelyTrading',
  is_etf: 'isEtf',
  is_fund: 'isFund',
  all_share_classes: 'includeAllShareClasses',
}

const numOrNull = z.number().nullable().default(null)

export const FMPEquityScreenerQueryParamsSchema = EquityScreenerQueryParamsSchema.extend({
  mktcap_min: z.coerce.number().nullable().default(null).describe('Minimum market capitalization.'),
  mktcap_max: z.coerce.number().nullable().default(null).describe('Maximum market capitalization.'),
  price_min: z.coerce.number().nullable().default(null).describe('Minimum price.'),
  price_max: z.coerce.number().nullable().default(null).describe('Maximum price.'),
  beta_min: z.coerce.number().nullable().default(null).describe('Minimum beta.'),
  beta_max: z.coerce.number().nullable().default(null).describe('Maximum beta.'),
  volume_min: z.coerce.number().nullable().default(null).describe('Minimum volume.'),
  volume_max: z.coerce.number().nullable().default(null).describe('Maximum volume.'),
  dividend_min: z.coerce.number().nullable().default(null).describe('Minimum dividend yield.'),
  dividend_max: z.coerce.number().nullable().default(null).describe('Maximum dividend yield.'),
  sector: z.string().nullable().default(null).describe('Sector filter.'),
  industry: z.string().nullable().default(null).describe('Industry filter.'),
  country: z.string().nullable().default(null).describe('Country filter.'),
  exchange: z.string().nullable().default(null).describe('Exchange filter.'),
  is_etf: z.boolean().nullable().default(null).describe('Filter for ETFs.'),
  is_active: z.boolean().nullable().default(null).describe('Filter for actively trading.'),
  is_fund: z.boolean().nullable().default(null).describe('Filter for funds.'),
  all_share_classes: z.boolean().nullable().default(null).describe('Include all share classes.'),
  limit: z.coerce.number().nullable().default(50000).describe('Maximum number of results.'),
})
export type FMPEquityScreenerQueryParams = z.infer<typeof FMPEquityScreenerQueryParamsSchema>

export const FMPEquityScreenerDataSchema = EquityScreenerDataSchema.extend({
  market_cap: numOrNull.describe('Market capitalization.'),
  sector: z.string().nullable().default(null).describe('Sector.'),
  industry: z.string().nullable().default(null).describe('Industry.'),
  beta: numOrNull.describe('Beta.'),
  price: numOrNull.describe('Current price.'),
  last_annual_dividend: numOrNull.describe('Last annual dividend.'),
  volume: numOrNull.describe('Volume.'),
  exchange: z.string().nullable().default(null).describe('Exchange.'),
  exchange_name: z.string().nullable().default(null).describe('Exchange name.'),
  country: z.string().nullable().default(null).describe('Country.'),
  is_etf: z.boolean().nullable().default(null).describe('Is ETF.'),
  is_fund: z.boolean().nullable().default(null).describe('Is fund.'),
  actively_trading: z.boolean().nullable().default(null).describe('Is actively trading.'),
}).passthrough()
export type FMPEquityScreenerData = z.infer<typeof FMPEquityScreenerDataSchema>

export class FMPEquityScreenerFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEquityScreenerQueryParams {
    return FMPEquityScreenerQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEquityScreenerQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const qs = new URLSearchParams()
    qs.set('apikey', apiKey)

    // Map query params to FMP API parameter names
    const mappings: [string, string, unknown][] = [
      ['marketCapMoreThan', 'mktcap_min', query.mktcap_min],
      ['marketCapLowerThan', 'mktcap_max', query.mktcap_max],
      ['priceMoreThan', 'price_min', query.price_min],
      ['priceLowerThan', 'price_max', query.price_max],
      ['betaMoreThan', 'beta_min', query.beta_min],
      ['betaLowerThan', 'beta_max', query.beta_max],
      ['volumeMoreThan', 'volume_min', query.volume_min],
      ['volumeLowerThan', 'volume_max', query.volume_max],
      ['dividendMoreThan', 'dividend_min', query.dividend_min],
      ['dividendLowerThan', 'dividend_max', query.dividend_max],
    ]
    for (const [apiName, , val] of mappings) {
      if (val != null) qs.set(apiName, String(val))
    }
    if (query.sector) qs.set('sector', query.sector)
    if (query.industry) qs.set('industry', query.industry)
    if (query.country) qs.set('country', query.country)
    if (query.exchange) qs.set('exchange', query.exchange)
    if (query.is_etf != null) qs.set('isEtf', String(query.is_etf))
    if (query.is_active != null) qs.set('isActivelyTrading', String(query.is_active))
    if (query.is_fund != null) qs.set('isFund', String(query.is_fund))
    if (query.all_share_classes != null) qs.set('includeAllShareClasses', String(query.all_share_classes))
    if (query.limit) qs.set('limit', String(query.limit))

    return getDataMany(
      `https://financialmodelingprep.com/stable/company-screener?${qs.toString()}`,
    )
  }

  static override transformData(
    _query: FMPEquityScreenerQueryParams,
    data: Record<string, unknown>[],
  ): FMPEquityScreenerData[] {
    return data.map(d => {
      const aliased = applyAliases(d, DATA_ALIAS_DICT)
      return FMPEquityScreenerDataSchema.parse(aliased)
    })
  }
}
