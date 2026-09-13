/**
 * Share Statistics Standard Model.
 * Maps to: standard_models/share_statistics.py
 */

import { z } from 'zod'

export const ShareStatisticsQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})
export type ShareStatisticsQueryParams = z.infer<typeof ShareStatisticsQueryParamsSchema>

const numOrNull = z.number().nullable().default(null)

export const ShareStatisticsDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity requested in the data.'),
  date: z.string().nullable().default(null).describe('The date of the data.'),
  free_float: numOrNull.describe('Percentage of unrestricted shares of a publicly-traded company.'),
  float_shares: numOrNull.describe('Number of shares available for trading by the general public.'),
  outstanding_shares: numOrNull.describe('Total number of shares of a publicly-traded company.'),
}).passthrough()
export type ShareStatisticsData = z.infer<typeof ShareStatisticsDataSchema>
