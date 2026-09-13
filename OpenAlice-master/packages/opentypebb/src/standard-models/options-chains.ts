/**
 * Options Chains Standard Model.
 * Maps to: openbb_core/provider/standard_models/options_chains.py
 *
 * Note: Python uses list-typed fields + model_serializer to zip into records.
 * In TypeScript we define the per-record schema directly.
 */

import { z } from 'zod'

export const OptionsChainsQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
}).passthrough()

export type OptionsChainsQueryParams = z.infer<typeof OptionsChainsQueryParamsSchema>

export const OptionsChainsDataSchema = z.object({
  underlying_symbol: z.string().nullable().default(null).describe('Underlying symbol for the option.'),
  underlying_price: z.number().nullable().default(null).describe('Price of the underlying stock.'),
  contract_symbol: z.string().describe('Contract symbol for the option.'),
  eod_date: z.string().nullable().default(null).describe('Date for which the options chains are returned.'),
  expiration: z.string().describe('Expiration date of the contract.'),
  dte: z.number().nullable().default(null).describe('Days to expiration of the contract.'),
  strike: z.number().describe('Strike price of the contract.'),
  option_type: z.string().describe('Call or Put.'),
  contract_size: z.number().nullable().default(null).describe('Number of underlying units per contract.'),
  open_interest: z.number().nullable().default(null).describe('Open interest on the contract.'),
  volume: z.number().nullable().default(null).describe('Trading volume.'),
  theoretical_price: z.number().nullable().default(null).describe('Theoretical value of the option.'),
  last_trade_price: z.number().nullable().default(null).describe('Last trade price of the option.'),
  last_trade_size: z.number().nullable().default(null).describe('Last trade size of the option.'),
  last_trade_time: z.string().nullable().default(null).describe('The timestamp of the last trade.'),
  tick: z.string().nullable().default(null).describe('Whether the last tick was up or down in price.'),
  bid: z.number().nullable().default(null).describe('Current bid price for the option.'),
  bid_size: z.number().nullable().default(null).describe('Bid size for the option.'),
  ask: z.number().nullable().default(null).describe('Current ask price for the option.'),
  ask_size: z.number().nullable().default(null).describe('Ask size for the option.'),
  mark: z.number().nullable().default(null).describe('The mid-price between the latest bid and ask.'),
  open: z.number().nullable().default(null).describe('Opening price.'),
  high: z.number().nullable().default(null).describe('High price.'),
  low: z.number().nullable().default(null).describe('Low price.'),
  close: z.number().nullable().default(null).describe('Close price.'),
  prev_close: z.number().nullable().default(null).describe('Previous close price.'),
  change: z.number().nullable().default(null).describe('The change in the price of the option.'),
  change_percent: z.number().nullable().default(null).describe('Change, in percent, of the option.'),
  implied_volatility: z.number().nullable().default(null).describe('Implied volatility of the option.'),
  delta: z.number().nullable().default(null).describe('Delta of the option.'),
  gamma: z.number().nullable().default(null).describe('Gamma of the option.'),
  theta: z.number().nullable().default(null).describe('Theta of the option.'),
  vega: z.number().nullable().default(null).describe('Vega of the option.'),
  rho: z.number().nullable().default(null).describe('Rho of the option.'),
}).passthrough()

export type OptionsChainsData = z.infer<typeof OptionsChainsDataSchema>
