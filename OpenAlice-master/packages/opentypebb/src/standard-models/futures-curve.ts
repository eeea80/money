/**
 * Futures Curve Standard Model.
 * Maps to: openbb_core/provider/standard_models/futures_curve.py
 */

import { z } from 'zod'

export const FuturesCurveQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
  date: z.string().nullable().default(null).describe('A specific date to get data for.'),
}).passthrough()

export type FuturesCurveQueryParams = z.infer<typeof FuturesCurveQueryParamsSchema>

export const FuturesCurveDataSchema = z.object({
  date: z.string().nullable().default(null).describe('The date of the data.'),
  expiration: z.string().describe('Futures expiration month.'),
  price: z.number().nullable().default(null).describe('The price of the futures contract.'),
}).passthrough()

export type FuturesCurveData = z.infer<typeof FuturesCurveDataSchema>
