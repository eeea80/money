/**
 * ETF Equity Exposure Standard Model.
 * Maps to: standard_models/etf_equity_exposure.py
 */

import { z } from 'zod'

export const EtfEquityExposureQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
})
export type EtfEquityExposureQueryParams = z.infer<typeof EtfEquityExposureQueryParamsSchema>

export const EtfEquityExposureDataSchema = z.object({
  equity_symbol: z.string().describe('The symbol of the equity.'),
  etf_symbol: z.string().describe('The symbol of the ETF.'),
  weight: z.number().nullable().default(null).describe('The weight of the equity in the ETF.'),
  market_value: z.number().nullable().default(null).describe('The market value of the equity in the ETF.'),
  shares: z.number().nullable().default(null).describe('The number of shares held.'),
}).passthrough()
export type EtfEquityExposureData = z.infer<typeof EtfEquityExposureDataSchema>
