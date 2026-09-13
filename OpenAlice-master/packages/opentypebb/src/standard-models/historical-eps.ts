/**
 * Historical EPS Standard Model.
 * Maps to: standard_models/historical_eps.py
 */

import { z } from 'zod'

export const HistoricalEpsQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})
export type HistoricalEpsQueryParams = z.infer<typeof HistoricalEpsQueryParamsSchema>

const numOrNull = z.number().nullable().default(null)

export const HistoricalEpsDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  date: z.string().describe('The date of the data.'),
  eps_actual: numOrNull.describe('Actual EPS.'),
  eps_estimated: numOrNull.describe('Estimated EPS.'),
}).passthrough()
export type HistoricalEpsData = z.infer<typeof HistoricalEpsDataSchema>
