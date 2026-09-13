/**
 * Market Snapshots Standard Model.
 * Maps to: openbb_core/provider/standard_models/market_snapshots.py
 */

import { z } from 'zod'

export const MarketSnapshotsQueryParamsSchema = z.object({}).passthrough()

export type MarketSnapshotsQueryParams = z.infer<typeof MarketSnapshotsQueryParamsSchema>

const numOrNull = z.number().nullable().default(null)

export const MarketSnapshotsDataSchema = z.object({
  exchange: z.string().nullable().default(null).describe('Exchange the security is listed on.'),
  symbol: z.string().describe('Symbol representing the entity.'),
  name: z.string().nullable().default(null).describe('Name of the company, fund, or security.'),
  open: numOrNull.describe('Opening price.'),
  high: numOrNull.describe('High price.'),
  low: numOrNull.describe('Low price.'),
  close: numOrNull.describe('Close price.'),
  volume: numOrNull.describe('Trading volume.'),
  prev_close: numOrNull.describe('Previous close price.'),
  change: numOrNull.describe('The change in price from the previous close.'),
  change_percent: numOrNull.describe('The change in price from the previous close, as a normalized percent.'),
}).passthrough()

export type MarketSnapshotsData = z.infer<typeof MarketSnapshotsDataSchema>
