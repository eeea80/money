/**
 * Government Trades Standard Model.
 * Maps to: standard_models/government_trades.py
 */

import { z } from 'zod'

export const GovernmentTradesQueryParamsSchema = z.object({
  symbol: z.string().nullable().default(null).transform(v => v ? v.toUpperCase() : null).describe('Symbol to get data for.'),
  chamber: z.enum(['house', 'senate', 'all']).default('all').describe('Government Chamber.'),
  limit: z.coerce.number().nullable().default(null).describe('The number of data entries to return.'),
})
export type GovernmentTradesQueryParams = z.infer<typeof GovernmentTradesQueryParamsSchema>

export const GovernmentTradesDataSchema = z.object({
  symbol: z.string().nullable().default(null).describe('Symbol representing the entity.'),
  date: z.string().describe('The date of the data.'),
  transaction_date: z.string().nullable().default(null).describe('Date of Transaction.'),
  representative: z.string().nullable().default(null).describe('Name of Representative.'),
}).passthrough()
export type GovernmentTradesData = z.infer<typeof GovernmentTradesDataSchema>
