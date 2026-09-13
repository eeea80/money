/**
 * Deribit Options Chains Model.
 * Maps to: openbb_deribit/models/options_chains.py
 *
 * Note: Python uses WebSocket connections. We use REST API for simplicity.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { OptionsChainsDataSchema } from '../../../standard-models/options-chains.js'
import { EmptyDataError, OpenBBError } from '../../../core/provider/utils/errors.js'
import { getOptionsSymbols, getTickerData, DERIBIT_OPTIONS_SYMBOLS } from '../utils/helpers.js'

export const DeribitOptionsChainsQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol: BTC, ETH, SOL, XRP, BNB, or PAXG.'),
}).passthrough()

export type DeribitOptionsChainsQueryParams = z.infer<typeof DeribitOptionsChainsQueryParamsSchema>

export const DeribitOptionsChainsDataSchema = OptionsChainsDataSchema
export type DeribitOptionsChainsData = z.infer<typeof DeribitOptionsChainsDataSchema>

export class DeribitOptionsChainsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): DeribitOptionsChainsQueryParams {
    return DeribitOptionsChainsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: DeribitOptionsChainsQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbol = query.symbol
    if (!DERIBIT_OPTIONS_SYMBOLS.includes(symbol)) {
      throw new OpenBBError(`Invalid symbol: ${symbol}. Valid: ${DERIBIT_OPTIONS_SYMBOLS.join(', ')}`)
    }

    const optionsMap = await getOptionsSymbols(symbol)
    if (Object.keys(optionsMap).length === 0) {
      throw new EmptyDataError('No options found.')
    }

    const allContracts = Object.values(optionsMap).flat()
    const results: Record<string, unknown>[] = []

    // Fetch tickers in batches to avoid rate limiting
    const batchSize = 20
    for (let i = 0; i < allContracts.length; i += batchSize) {
      const batch = allContracts.slice(i, i + batchSize)
      const tasks = batch.map(async (name) => {
        try {
          return await getTickerData(name)
        } catch {
          return null
        }
      })
      const batchResults = await Promise.all(tasks)
      for (const t of batchResults) {
        if (t) results.push(t)
      }
    }

    if (results.length === 0) throw new EmptyDataError('No options data found.')
    return results
  }

  static override transformData(
    query: DeribitOptionsChainsQueryParams,
    data: Record<string, unknown>[],
  ): DeribitOptionsChainsData[] {
    return data.map(d => {
      const name = d.instrument_name as string
      // Parse: BTC-28MAR25-100000-C
      const parts = name.split('-')
      const expiration = parts[1] ?? ''
      const strike = parseFloat(parts[2] ?? '0')
      const optionType = parts[3] === 'C' ? 'call' : 'put'

      // Get underlying price for USD conversion
      const underlyingPrice = d.underlying_price as number | null
      const indexPrice = d.index_price as number | null
      const refPrice = underlyingPrice ?? indexPrice ?? 1

      return OptionsChainsDataSchema.parse({
        underlying_symbol: query.symbol,
        underlying_price: refPrice,
        contract_symbol: name,
        expiration,
        strike,
        option_type: optionType,
        open_interest: d.open_interest ?? null,
        volume: d.stats ? (d.stats as Record<string, unknown>).volume ?? null : null,
        last_trade_price: d.last_price != null ? (d.last_price as number) * refPrice : null,
        bid: d.best_bid_price != null ? (d.best_bid_price as number) * refPrice : null,
        bid_size: d.best_bid_amount ?? null,
        ask: d.best_ask_price != null ? (d.best_ask_price as number) * refPrice : null,
        ask_size: d.best_ask_amount ?? null,
        mark: d.mark_price != null ? (d.mark_price as number) * refPrice : null,
        implied_volatility: d.mark_iv != null ? (d.mark_iv as number) / 100 : null,
        delta: d.greeks ? (d.greeks as Record<string, unknown>).delta ?? null : null,
        gamma: d.greeks ? (d.greeks as Record<string, unknown>).gamma ?? null : null,
        theta: d.greeks ? (d.greeks as Record<string, unknown>).theta ?? null : null,
        vega: d.greeks ? (d.greeks as Record<string, unknown>).vega ?? null : null,
        rho: d.greeks ? (d.greeks as Record<string, unknown>).rho ?? null : null,
      })
    })
  }
}
