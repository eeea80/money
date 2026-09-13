/**
 * Central Bank Holdings Standard Model.
 * Maps to: openbb_core/provider/standard_models/central_bank_holdings.py
 */

import { z } from 'zod'

export const CentralBankHoldingsQueryParamsSchema = z.object({
  date: z.string().nullable().default(null).describe('A specific date to get data for.'),
}).passthrough()

export type CentralBankHoldingsQueryParams = z.infer<typeof CentralBankHoldingsQueryParamsSchema>

export const CentralBankHoldingsDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
}).passthrough()

export type CentralBankHoldingsData = z.infer<typeof CentralBankHoldingsDataSchema>
