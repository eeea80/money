/**
 * Commodity Spot Price Standard Model.
 */

import { z } from 'zod'

export const CommoditySpotPriceQueryParamsSchema = z.object({
  symbol: z.string().describe('Commodity futures symbol(s), comma-separated (e.g., "GC=F,CL=F,SI=F").'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type CommoditySpotPriceQueryParams = z.infer<typeof CommoditySpotPriceQueryParamsSchema>

export const CommoditySpotPriceDataSchema = z.object({
  date: z.string().describe('Trade date.'),
  symbol: z.string().nullable().default(null).describe('Commodity symbol.'),
  open: z.number().nullable().default(null).describe('Opening price.'),
  high: z.number().nullable().default(null).describe('High price.'),
  low: z.number().nullable().default(null).describe('Low price.'),
  close: z.number().nullable().default(null).describe('Closing price.'),
  volume: z.number().nullable().default(null).describe('Trade volume.'),
}).passthrough()

export type CommoditySpotPriceData = z.infer<typeof CommoditySpotPriceDataSchema>
