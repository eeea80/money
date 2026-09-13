/**
 * Equity Discovery Standard Models (Gainers, Losers, Active).
 * Maps to: openbb_core/provider/standard_models/equity_gainers.py (and similar)
 *
 * Note: In OpenBB Python, equity_gainers.py does not exist as a standard model.
 * The gainers/losers/active endpoints are provider-specific. We define a common
 * standard model here for TypeScript consistency.
 */

import { z } from 'zod'

export const EquityDiscoveryQueryParamsSchema = z.object({
  sort: z.string().nullable().default(null).describe('Sort order.'),
}).passthrough()

export type EquityDiscoveryQueryParams = z.infer<typeof EquityDiscoveryQueryParamsSchema>

export const EquityDiscoveryDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  name: z.string().nullable().default(null).describe('Name of the entity.'),
  price: z.number().nullable().default(null).describe('Last price.'),
  change: z.number().nullable().default(null).describe('Change in price.'),
  percent_change: z.number().nullable().default(null).describe('Percent change in price.'),
  volume: z.number().nullable().default(null).describe('Trading volume.'),
  // Right-side volume context — populated by providers that carry it (yfinance
  // screeners); null elsewhere. relative_volume = volume / 3-month average, the
  // cross-ticker-comparable read of whether a name is trading unusually.
  avg_volume: z.number().nullable().default(null).describe('Average daily trading volume over the trailing 3 months.'),
  relative_volume: z.number().nullable().default(null).describe("Today's volume divided by the 3-month average. >1 means heavier than usual (relative, intra-ticker read)."),
  turnover: z.number().nullable().default(null).describe("Today's volume divided by shares outstanding (share turnover)."),
  dollar_volume: z.number().nullable().default(null).describe("Price × volume — traded notional. The cross-ticker-comparable absolute read; aggregates to a sector."),
}).passthrough()

export type EquityDiscoveryData = z.infer<typeof EquityDiscoveryDataSchema>
