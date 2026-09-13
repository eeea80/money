/**
 * Options Snapshots Standard Model.
 * Maps to: openbb_core/provider/standard_models/options_snapshots.py
 *
 * Note: Python uses list-typed fields. In TypeScript we define per-record schema.
 */

import { z } from 'zod'

export const OptionsSnapshotsQueryParamsSchema = z.object({}).passthrough()

export type OptionsSnapshotsQueryParams = z.infer<typeof OptionsSnapshotsQueryParamsSchema>

export const OptionsSnapshotsDataSchema = z.object({
  underlying_symbol: z.string().describe('Ticker symbol of the underlying asset.'),
  contract_symbol: z.string().describe('Symbol of the options contract.'),
  expiration: z.string().describe('Expiration date of the options contract.'),
  dte: z.number().nullable().default(null).describe('Number of days to expiration.'),
  strike: z.number().describe('Strike price of the options contract.'),
  option_type: z.string().describe('The type of option.'),
  volume: z.number().nullable().default(null).describe('Trading volume.'),
  open_interest: z.number().nullable().default(null).describe('Open interest at the time.'),
  last_price: z.number().nullable().default(null).describe('Last trade price.'),
  last_size: z.number().nullable().default(null).describe('Lot size of the last trade.'),
  last_timestamp: z.string().nullable().default(null).describe('Timestamp of the last price.'),
  open: z.number().nullable().default(null).describe('Opening price.'),
  high: z.number().nullable().default(null).describe('High price.'),
  low: z.number().nullable().default(null).describe('Low price.'),
  close: z.number().nullable().default(null).describe('Close price.'),
}).passthrough()

export type OptionsSnapshotsData = z.infer<typeof OptionsSnapshotsDataSchema>
