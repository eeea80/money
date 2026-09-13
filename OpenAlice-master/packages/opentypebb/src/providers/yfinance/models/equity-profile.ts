/**
 * YFinance Equity Profile Model.
 * Maps to: openbb_yfinance/models/equity_profile.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityInfoQueryParamsSchema, EquityInfoDataSchema } from '../../../standard-models/equity-info.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getQuoteSummary } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  name: 'longName',
  issue_type: 'quoteType',
  stock_exchange: 'exchange',
  exchange_timezone: 'timeZoneFullName',
  industry_category: 'industry',
  hq_country: 'country',
  hq_address1: 'address1',
  hq_address_city: 'city',
  hq_address_postal_code: 'zip',
  hq_state: 'state',
  business_phone_no: 'phone',
  company_url: 'website',
  long_description: 'longBusinessSummary',
  employees: 'fullTimeEmployees',
  market_cap: 'marketCap',
  shares_outstanding: 'sharesOutstanding',
  shares_float: 'floatShares',
  shares_implied_outstanding: 'impliedSharesOutstanding',
  shares_short: 'sharesShort',
  dividend_yield: 'dividendYield',
}

export const YFinanceEquityProfileQueryParamsSchema = EquityInfoQueryParamsSchema
export type YFinanceEquityProfileQueryParams = z.infer<typeof YFinanceEquityProfileQueryParamsSchema>

export const YFinanceEquityProfileDataSchema = EquityInfoDataSchema.extend({
  exchange_timezone: z.string().nullable().default(null).describe('The timezone of the exchange.'),
  issue_type: z.string().nullable().default(null).describe('The issuance type of the asset.'),
  currency: z.string().nullable().default(null).describe('The currency in which the asset is traded.'),
  market_cap: z.number().nullable().default(null).describe('The market capitalization of the asset.'),
  shares_outstanding: z.number().nullable().default(null).describe('The number of listed shares outstanding.'),
  shares_float: z.number().nullable().default(null).describe('The number of shares in the public float.'),
  shares_implied_outstanding: z.number().nullable().default(null).describe('Implied shares outstanding.'),
  shares_short: z.number().nullable().default(null).describe('The reported number of shares short.'),
  dividend_yield: z.number().nullable().default(null).describe('The dividend yield of the asset.'),
  beta: z.number().nullable().default(null).describe('The beta of the asset relative to the broad market.'),
}).strip()
export type YFinanceEquityProfileData = z.infer<typeof YFinanceEquityProfileDataSchema>

export class YFinanceEquityProfileFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceEquityProfileQueryParams {
    return YFinanceEquityProfileQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceEquityProfileQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbols = query.symbol.split(',').map(s => s.trim()).filter(Boolean)
    const results = await Promise.allSettled(
      symbols.map(s => getQuoteSummary(s, ['summaryProfile', 'summaryDetail', 'price', 'defaultKeyStatistics']))
    )
    const data: Record<string, unknown>[] = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) data.push(r.value)
    }
    return data
  }

  static override transformData(
    query: YFinanceEquityProfileQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceEquityProfileData[] {
    if (!data.length) throw new EmptyDataError('No profile data returned')
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      // Convert epoch timestamp for first_stock_price_date
      if (typeof aliased.first_stock_price_date === 'number') {
        aliased.first_stock_price_date = new Date(aliased.first_stock_price_date * 1000).toISOString().slice(0, 10)
      }
      // yahoo-finance2 returns dividend_yield as a decimal (0.0039),
      // OpenBB Python reports it as a percentage (0.39). Multiply by 100.
      if (typeof aliased.dividend_yield === 'number') {
        aliased.dividend_yield = Math.round(aliased.dividend_yield * 10000) / 100
      }
      return YFinanceEquityProfileDataSchema.parse(aliased)
    })
  }
}
