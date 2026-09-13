/**
 * Currency Snapshots Standard Model.
 * Maps to: openbb_core/provider/standard_models/currency_snapshots.py
 */

import { z } from 'zod'

export const CurrencySnapshotsQueryParamsSchema = z.object({
  base: z.string().default('usd').describe('The base currency symbol.'),
  quote_type: z.enum(['direct', 'indirect']).default('indirect').describe('Whether the quote is direct or indirect.'),
  counter_currencies: z.string().nullable().default(null).describe('An optional comma-separated list of counter currency symbols to filter for.'),
}).passthrough()

export type CurrencySnapshotsQueryParams = z.infer<typeof CurrencySnapshotsQueryParamsSchema>

const numOrNull = z.number().nullable().default(null)

export const CurrencySnapshotsDataSchema = z.object({
  base_currency: z.string().describe('The base, or domestic, currency.'),
  counter_currency: z.string().describe('The counter, or foreign, currency.'),
  last_rate: z.number().describe('The exchange rate, relative to the base currency.'),
  open: numOrNull.describe('Opening price.'),
  high: numOrNull.describe('High price.'),
  low: numOrNull.describe('Low price.'),
  close: numOrNull.describe('Close price.'),
  volume: numOrNull.describe('Trading volume.'),
  prev_close: numOrNull.describe('Previous close price.'),
}).passthrough()

export type CurrencySnapshotsData = z.infer<typeof CurrencySnapshotsDataSchema>
