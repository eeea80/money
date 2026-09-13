/**
 * Equity Quote Standard Model.
 * Maps to: openbb_core/provider/standard_models/equity_quote.py
 */

import { z } from 'zod'

export const EquityQuoteQueryParamsSchema = z.object({
  symbol: z.string().transform((v) => v.toUpperCase()),
}).passthrough()

export type EquityQuoteQueryParams = z.infer<typeof EquityQuoteQueryParamsSchema>

export const EquityQuoteDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity requested in the data.'),
  asset_type: z.string().nullable().default(null).describe('Type of asset - i.e, stock, ETF, etc.'),
  name: z.string().nullable().default(null).describe('Name of the company or asset.'),
  exchange: z.string().nullable().default(null).describe('The name or symbol of the venue where the data is from.'),
  bid: z.number().nullable().default(null).describe('Price of the top bid order.'),
  bid_size: z.number().int().nullable().default(null).describe('Number of round lot orders at the bid price.'),
  ask: z.number().nullable().default(null).describe('Price of the top ask order.'),
  ask_size: z.number().int().nullable().default(null).describe('Number of round lot orders at the ask price.'),
  last_price: z.number().nullable().default(null).describe('Price of the last trade.'),
  last_size: z.number().int().nullable().default(null).describe('Size of the last trade.'),
  last_timestamp: z.string().nullable().default(null).describe('Date and Time when the last price was recorded.'),
  open: z.number().nullable().default(null).describe('The open price.'),
  high: z.number().nullable().default(null).describe('The high price.'),
  low: z.number().nullable().default(null).describe('The low price.'),
  close: z.number().nullable().default(null).describe('The close price.'),
  volume: z.number().nullable().default(null).describe('The trading volume.'),
  prev_close: z.number().nullable().default(null).describe('The previous close price.'),
  change: z.number().nullable().default(null).describe('Change in price from previous close.'),
  change_percent: z.number().nullable().default(null).describe('Change in price as a normalized percentage.'),
  year_high: z.number().nullable().default(null).describe('The one year high (52W High).'),
  year_low: z.number().nullable().default(null).describe('The one year low (52W Low).'),
}).passthrough()

export type EquityQuoteData = z.infer<typeof EquityQuoteDataSchema>
