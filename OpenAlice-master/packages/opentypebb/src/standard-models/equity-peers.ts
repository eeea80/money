/**
 * Equity Peers Standard Model.
 * Maps to: standard_models/equity_peers.py
 */

import { z } from 'zod'

export const EquityPeersQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})
export type EquityPeersQueryParams = z.infer<typeof EquityPeersQueryParamsSchema>

export const EquityPeersDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
}).passthrough()
export type EquityPeersData = z.infer<typeof EquityPeersDataSchema>
