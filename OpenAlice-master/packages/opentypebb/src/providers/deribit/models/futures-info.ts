/**
 * Deribit Futures Info Model.
 * Maps to: openbb_deribit/models/futures_info.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EmptyDataError, OpenBBError } from '../../../core/provider/utils/errors.js'
import { getTickerData, getFuturesSymbols, getPerpetualSymbols } from '../utils/helpers.js'

export const DeribitFuturesInfoQueryParamsSchema = z.object({
  symbol: z.string().describe('Deribit futures instrument symbol(s), comma-separated.'),
}).passthrough()

export type DeribitFuturesInfoQueryParams = z.infer<typeof DeribitFuturesInfoQueryParamsSchema>

export const DeribitFuturesInfoDataSchema = z.object({
  symbol: z.string().describe('Instrument name.'),
  state: z.string().describe('The state of the order book.'),
  open_interest: z.number().describe('Total outstanding contracts.'),
  index_price: z.number().describe('Current index price.'),
  best_ask_price: z.number().nullable().default(null).describe('Best ask price.'),
  best_ask_amount: z.number().nullable().default(null).describe('Best ask amount.'),
  best_bid_price: z.number().nullable().default(null).describe('Best bid price.'),
  best_bid_amount: z.number().nullable().default(null).describe('Best bid amount.'),
  last_price: z.number().nullable().default(null).describe('Last trade price.'),
  high: z.number().nullable().default(null).describe('Highest price during 24h.'),
  low: z.number().nullable().default(null).describe('Lowest price during 24h.'),
  change_percent: z.number().nullable().default(null).describe('24-hour price change percent.'),
  volume: z.number().nullable().default(null).describe('Volume during last 24h in base currency.'),
  volume_usd: z.number().nullable().default(null).describe('Volume in USD.'),
  mark_price: z.number().describe('Mark price for the instrument.'),
  settlement_price: z.number().nullable().default(null).describe('Settlement price.'),
  delivery_price: z.number().nullable().default(null).describe('Delivery price (closed instruments).'),
  estimated_delivery_price: z.number().nullable().default(null).describe('Estimated delivery price.'),
  current_funding: z.number().nullable().default(null).describe('Current funding (perpetual only).'),
  funding_8h: z.number().nullable().default(null).describe('Funding 8h (perpetual only).'),
  max_price: z.number().nullable().default(null).describe('Maximum order price.'),
  min_price: z.number().nullable().default(null).describe('Minimum order price.'),
  timestamp: z.number().nullable().default(null).describe('Timestamp of the data.'),
}).passthrough()

export type DeribitFuturesInfoData = z.infer<typeof DeribitFuturesInfoDataSchema>

export class DeribitFuturesInfoFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): DeribitFuturesInfoQueryParams {
    return DeribitFuturesInfoQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: DeribitFuturesInfoQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbols = query.symbol.split(',')
    const perpetualSymbols = await getPerpetualSymbols()
    const futuresSymbols = await getFuturesSymbols()
    const allSymbols = [...futuresSymbols, ...Object.keys(perpetualSymbols)]

    const resolvedSymbols = symbols.map(s => {
      if (perpetualSymbols[s]) return perpetualSymbols[s]
      if (allSymbols.includes(s)) return s
      throw new OpenBBError(`Invalid symbol: ${s}`)
    })

    const results: Record<string, unknown>[] = []
    const tasks = resolvedSymbols.map(async (sym) => {
      try {
        return await getTickerData(sym)
      } catch {
        return null
      }
    })
    const tickerResults = await Promise.all(tasks)
    for (const t of tickerResults) {
      if (t) results.push(t)
    }

    if (results.length === 0) throw new EmptyDataError('No data found.')
    return results
  }

  static override transformData(
    _query: DeribitFuturesInfoQueryParams,
    data: Record<string, unknown>[],
  ): DeribitFuturesInfoData[] {
    return data.map(d => {
      const priceChange = d.price_change as number | null
      return DeribitFuturesInfoDataSchema.parse({
        ...d,
        symbol: d.instrument_name,
        change_percent: priceChange != null ? priceChange / 100 : null,
      })
    })
  }
}
