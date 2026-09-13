/**
 * FMP Market Snapshots Model.
 * Maps to: openbb_fmp/models/market_snapshots.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { MarketSnapshotsQueryParamsSchema, MarketSnapshotsDataSchema } from '../../../standard-models/market-snapshots.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'

const ALIAS_DICT: Record<string, string> = {
  high: 'dayHigh',
  low: 'dayLow',
  prev_close: 'previousClose',
  change_percent: 'changePercentage',
  close: 'price',
  last_price_timestamp: 'timestamp',
  ma50: 'priceAvg50',
  ma200: 'priceAvg200',
  year_high: 'yearHigh',
  year_low: 'yearLow',
  market_cap: 'marketCap',
}

const numOrNull = z.number().nullable().default(null)

export const FMPMarketSnapshotsQueryParamsSchema = MarketSnapshotsQueryParamsSchema.extend({
  market: z.string().default('nasdaq').describe('The market to fetch data for (e.g., nasdaq, nyse, etf, crypto, forex, index, commodity, mutual_fund).'),
})
export type FMPMarketSnapshotsQueryParams = z.infer<typeof FMPMarketSnapshotsQueryParamsSchema>

export const FMPMarketSnapshotsDataSchema = MarketSnapshotsDataSchema.extend({
  ma50: numOrNull.describe('The 50-day moving average.'),
  ma200: numOrNull.describe('The 200-day moving average.'),
  year_high: numOrNull.describe('The 52-week high.'),
  year_low: numOrNull.describe('The 52-week low.'),
  market_cap: numOrNull.describe('Market cap of the stock.'),
  last_price_timestamp: z.string().nullable().default(null).describe('The timestamp of the last price.'),
}).passthrough()
export type FMPMarketSnapshotsData = z.infer<typeof FMPMarketSnapshotsDataSchema>

export class FMPMarketSnapshotsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPMarketSnapshotsQueryParams {
    return FMPMarketSnapshotsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPMarketSnapshotsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const baseUrl = 'https://financialmodelingprep.com/stable/batch-'
    const market = query.market.toUpperCase()

    let url: string
    if (market === 'ETF') {
      url = `${baseUrl}etf-quotes?short=false&apikey=${apiKey}`
    } else if (market === 'MUTUAL_FUND') {
      url = `${baseUrl}mutualfund-quotes?short=false&apikey=${apiKey}`
    } else if (market === 'FOREX') {
      url = `${baseUrl}forex-quotes?short=false&apikey=${apiKey}`
    } else if (market === 'CRYPTO') {
      url = `${baseUrl}crypto-quotes?short=false&apikey=${apiKey}`
    } else if (market === 'INDEX') {
      url = `${baseUrl}index-quotes?short=false&apikey=${apiKey}`
    } else if (market === 'COMMODITY') {
      url = `${baseUrl}commodity-quotes?short=false&apikey=${apiKey}`
    } else {
      url = `${baseUrl}exchange-quote?exchange=${market}&short=false&apikey=${apiKey}`
    }

    return getDataMany(url)
  }

  static override transformData(
    _query: FMPMarketSnapshotsQueryParams,
    data: Record<string, unknown>[],
  ): FMPMarketSnapshotsData[] {
    if (!data || data.length === 0) {
      throw new EmptyDataError('No data was returned')
    }

    // Filter to most recent day only (based on timestamp)
    const withTimestamps = data.filter(d => typeof d.timestamp === 'number')
    if (withTimestamps.length > 0) {
      const maxTs = Math.max(...withTimestamps.map(d => d.timestamp as number))
      const maxDate = new Date(maxTs * 1000).toISOString().split('T')[0]
      data = data.filter(d => {
        if (typeof d.timestamp !== 'number') return false
        const itemDate = new Date((d.timestamp as number) * 1000).toISOString().split('T')[0]
        return itemDate === maxDate
      })
    }

    // Sort by timestamp descending
    data.sort((a, b) => ((b.timestamp as number) ?? 0) - ((a.timestamp as number) ?? 0))

    return data.map(d => {
      // Normalize change_percent
      if (typeof d.changePercentage === 'number') {
        d.changePercentage = d.changePercentage / 100
      }
      // Convert Unix timestamp to ISO string
      if (typeof d.timestamp === 'number') {
        d.timestamp = new Date(d.timestamp * 1000).toISOString()
      }
      // Clean empty name strings
      if (d.name === '' || d.name === "''" || d.name === ' ') {
        d.name = null
      }
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPMarketSnapshotsDataSchema.parse(aliased)
    })
  }
}
