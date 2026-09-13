/**
 * FMP Risk Premium Model.
 * Maps to: openbb_fmp/models/risk_premium.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { RiskPremiumQueryParamsSchema, RiskPremiumDataSchema } from '../../../standard-models/risk-premium.js'
import { getDataMany } from '../utils/helpers.js'

export const FMPRiskPremiumQueryParamsSchema = RiskPremiumQueryParamsSchema
export type FMPRiskPremiumQueryParams = z.infer<typeof FMPRiskPremiumQueryParamsSchema>

export const FMPRiskPremiumDataSchema = RiskPremiumDataSchema
export type FMPRiskPremiumData = z.infer<typeof FMPRiskPremiumDataSchema>

export class FMPRiskPremiumFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPRiskPremiumQueryParams {
    return FMPRiskPremiumQueryParamsSchema.parse(params)
  }

  static override async extractData(
    _query: FMPRiskPremiumQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(
      `https://financialmodelingprep.com/stable/market-risk-premium?apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPRiskPremiumQueryParams,
    data: Record<string, unknown>[],
  ): FMPRiskPremiumData[] {
    return data.map(d => FMPRiskPremiumDataSchema.parse(d))
  }
}
