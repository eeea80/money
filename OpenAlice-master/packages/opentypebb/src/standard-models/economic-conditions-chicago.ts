/**
 * Chicago Fed National Activity Index Standard Model.
 * Maps to: openbb_core/provider/standard_models/economic_conditions_chicago.py
 */

import { z } from 'zod'

export const EconomicConditionsChicagoQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type EconomicConditionsChicagoQueryParams = z.infer<typeof EconomicConditionsChicagoQueryParamsSchema>

export const EconomicConditionsChicagoDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  cfnai: z.number().nullable().default(null).describe('Chicago Fed National Activity Index.'),
  cfnai_ma3: z.number().nullable().default(null).describe('CFNAI 3-month moving average.'),
}).passthrough()

export type EconomicConditionsChicagoData = z.infer<typeof EconomicConditionsChicagoDataSchema>
