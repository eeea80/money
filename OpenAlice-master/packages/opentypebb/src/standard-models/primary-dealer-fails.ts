/**
 * Primary Dealer Fails Standard Model.
 * Maps to: openbb_core/provider/standard_models/primary_dealer_fails.py
 */

import { z } from 'zod'

export const PrimaryDealerFailsQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type PrimaryDealerFailsQueryParams = z.infer<typeof PrimaryDealerFailsQueryParamsSchema>

export const PrimaryDealerFailsDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
}).passthrough()

export type PrimaryDealerFailsData = z.infer<typeof PrimaryDealerFailsDataSchema>
