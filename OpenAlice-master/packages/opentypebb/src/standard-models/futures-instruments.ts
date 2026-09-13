/**
 * Futures Instruments Standard Model.
 * Maps to: openbb_core/provider/standard_models/futures_instruments.py
 */

import { z } from 'zod'

export const FuturesInstrumentsQueryParamsSchema = z.object({}).passthrough()

export type FuturesInstrumentsQueryParams = z.infer<typeof FuturesInstrumentsQueryParamsSchema>

export const FuturesInstrumentsDataSchema = z.object({}).passthrough()

export type FuturesInstrumentsData = z.infer<typeof FuturesInstrumentsDataSchema>
