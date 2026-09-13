/**
 * Direction of Trade Standard Model.
 * Maps to: openbb_core/provider/standard_models/direction_of_trade.py
 */

import { z } from 'zod'

export const DirectionOfTradeQueryParamsSchema = z.object({
  country: z.string().nullable().default(null).describe('The country to get data for. None is equivalent to all.'),
  counterpart: z.string().nullable().default(null).describe('Counterpart country to the trade.'),
  direction: z.enum(['exports', 'imports', 'balance', 'all']).default('balance').describe('Trade direction.'),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
  frequency: z.enum(['month', 'quarter', 'annual']).default('month').describe('The frequency of the data.'),
}).passthrough()

export type DirectionOfTradeQueryParams = z.infer<typeof DirectionOfTradeQueryParamsSchema>

export const DirectionOfTradeDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  symbol: z.string().nullable().default(null).describe('Symbol representing the entity.'),
  country: z.string().describe('The country.'),
  counterpart: z.string().describe('Counterpart country or region to the trade.'),
  title: z.string().nullable().default(null).describe('Title corresponding to the symbol.'),
  value: z.number().describe('Trade value.'),
  scale: z.string().nullable().default(null).describe('Scale of the value.'),
}).passthrough()

export type DirectionOfTradeData = z.infer<typeof DirectionOfTradeDataSchema>
