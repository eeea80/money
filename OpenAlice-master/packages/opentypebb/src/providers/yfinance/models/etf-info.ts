/**
 * Yahoo Finance ETF Info Model.
 * Maps to: openbb_yfinance/models/etf_info.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EtfInfoQueryParamsSchema, EtfInfoDataSchema } from '../../../standard-models/etf-info.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getQuoteSummary } from '../utils/helpers.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  name: 'longName',
  inception_date: 'fundInceptionDate',
  description: 'longBusinessSummary',
  fund_type: 'legalType',
  fund_family: 'fundFamily',
  exchange_timezone: 'timeZoneFullName',
  nav_price: 'navPrice',
  total_assets: 'totalAssets',
  trailing_pe: 'trailingPE',
  dividend_yield: 'yield',
  dividend_rate_ttm: 'trailingAnnualDividendRate',
  dividend_yield_ttm: 'trailingAnnualDividendYield',
  year_high: 'fiftyTwoWeekHigh',
  year_low: 'fiftyTwoWeekLow',
  ma_50d: 'fiftyDayAverage',
  ma_200d: 'twoHundredDayAverage',
  return_ytd: 'ytdReturn',
  return_3y_avg: 'threeYearAverageReturn',
  return_5y_avg: 'fiveYearAverageReturn',
  beta_3y_avg: 'beta3Year',
  volume_avg: 'averageVolume',
  volume_avg_10d: 'averageDailyVolume10Day',
  bid_size: 'bidSize',
  ask_size: 'askSize',
  high: 'dayHigh',
  low: 'dayLow',
  prev_close: 'previousClose',
}

const numOrNull = z.number().nullable().default(null)

export const YFinanceEtfInfoQueryParamsSchema = EtfInfoQueryParamsSchema
export type YFinanceEtfInfoQueryParams = z.infer<typeof YFinanceEtfInfoQueryParamsSchema>

export const YFinanceEtfInfoDataSchema = EtfInfoDataSchema.extend({
  fund_type: z.string().nullable().default(null).describe('The legal type of fund.'),
  fund_family: z.string().nullable().default(null).describe('The fund family.'),
  category: z.string().nullable().default(null).describe('The fund category.'),
  exchange: z.string().nullable().default(null).describe('The exchange the fund is listed on.'),
  exchange_timezone: z.string().nullable().default(null).describe('The timezone of the exchange.'),
  currency: z.string().nullable().default(null).describe('The currency the fund is listed in.'),
  nav_price: numOrNull.describe('The net asset value per unit of the fund.'),
  total_assets: numOrNull.describe('The total value of assets held by the fund.'),
  trailing_pe: numOrNull.describe('The trailing twelve month P/E ratio.'),
  dividend_yield: numOrNull.describe('The dividend yield of the fund, as a normalized percent.'),
  dividend_rate_ttm: numOrNull.describe('The trailing twelve month annual dividend rate.'),
  dividend_yield_ttm: numOrNull.describe('The trailing twelve month annual dividend yield.'),
  year_high: numOrNull.describe('The fifty-two week high price.'),
  year_low: numOrNull.describe('The fifty-two week low price.'),
  ma_50d: numOrNull.describe('50-day moving average price.'),
  ma_200d: numOrNull.describe('200-day moving average price.'),
  return_ytd: numOrNull.describe('The year-to-date return, as a normalized percent.'),
  return_3y_avg: numOrNull.describe('The three year average return, as a normalized percent.'),
  return_5y_avg: numOrNull.describe('The five year average return, as a normalized percent.'),
  beta_3y_avg: numOrNull.describe('The three year average beta.'),
  volume_avg: numOrNull.describe('The average daily trading volume.'),
  volume_avg_10d: numOrNull.describe('The average daily trading volume over the past ten days.'),
  bid: numOrNull.describe('The current bid price.'),
  bid_size: numOrNull.describe('The current bid size.'),
  ask: numOrNull.describe('The current ask price.'),
  ask_size: numOrNull.describe('The current ask size.'),
  open: numOrNull.describe('The open price of the most recent trading session.'),
  high: numOrNull.describe('The highest price of the most recent trading session.'),
  low: numOrNull.describe('The lowest price of the most recent trading session.'),
  volume: numOrNull.describe('The trading volume of the most recent trading session.'),
  prev_close: numOrNull.describe('The previous closing price.'),
}).passthrough()
export type YFinanceEtfInfoData = z.infer<typeof YFinanceEtfInfoDataSchema>

const ETF_MODULES = [
  'defaultKeyStatistics',
  'summaryDetail',
  'summaryProfile',
  'financialData',
  'price',
  'fundProfile',
]

export class YFinanceEtfInfoFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceEtfInfoQueryParams {
    return YFinanceEtfInfoQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceEtfInfoQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbols = query.symbol.split(',').map(s => s.trim()).filter(Boolean)
    const results: Record<string, unknown>[] = []

    const settled = await Promise.allSettled(
      symbols.map(async (sym) => {
        const data = await getQuoteSummary(sym, ETF_MODULES)
        return { ...data, symbol: sym }
      })
    )

    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value)
      }
    }

    if (!results.length) {
      throw new EmptyDataError('No ETF info data returned')
    }

    return results
  }

  static override transformData(
    _query: YFinanceEtfInfoQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceEtfInfoData[] {
    return data.map(d => {
      // Handle inception date conversion
      if (d.fundInceptionDate != null) {
        const v = d.fundInceptionDate
        if (v instanceof Date) {
          d.fundInceptionDate = v.toISOString().slice(0, 10)
        } else if (typeof v === 'number') {
          d.fundInceptionDate = new Date(v * 1000).toISOString().slice(0, 10)
        }
      }
      // Fallback to firstTradeDateEpochUtc if no inception date
      if (!d.fundInceptionDate && d.firstTradeDateEpochUtc != null) {
        const ts = d.firstTradeDateEpochUtc as number
        d.fundInceptionDate = new Date(ts * 1000).toISOString().slice(0, 10)
      }

      const aliased = applyAliases(d, ALIAS_DICT)
      return YFinanceEtfInfoDataSchema.parse(aliased)
    })
  }
}
