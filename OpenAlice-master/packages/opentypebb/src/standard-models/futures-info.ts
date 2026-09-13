/**
 * Futures Info Standard Model.
 * Maps to: openbb_core/provider/standard_models/futures_info.py
 */

import { z } from 'zod'

export const FuturesInfoQueryParamsSchema = z.object({}).passthrough()

export type FuturesInfoQueryParams = z.infer<typeof FuturesInfoQueryParamsSchema>

export const FuturesInfoDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
}).passthrough()

export type FuturesInfoData = z.infer<typeof FuturesInfoDataSchema>
