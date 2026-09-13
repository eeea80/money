/**
 * FMP ETF Equity Exposure Model.
 * Maps to: openbb_fmp/models/etf_equity_exposure.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EtfEquityExposureQueryParamsSchema, EtfEquityExposureDataSchema } from '../../../standard-models/etf-equity-exposure.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  equity_symbol: 'assetExposure',
  etf_symbol: 'etfSymbol',
  shares: 'sharesNumber',
  weight: 'weightPercentage',
  market_value: 'marketValue',
}

const numOrNull = z.number().nullable().default(null)

export const FMPEtfEquityExposureQueryParamsSchema = EtfEquityExposureQueryParamsSchema
export type FMPEtfEquityExposureQueryParams = z.infer<typeof FMPEtfEquityExposureQueryParamsSchema>

export const FMPEtfEquityExposureDataSchema = EtfEquityExposureDataSchema.passthrough()
export type FMPEtfEquityExposureData = z.infer<typeof FMPEtfEquityExposureDataSchema>

export class FMPEtfEquityExposureFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEtfEquityExposureQueryParams {
    return FMPEtfEquityExposureQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEtfEquityExposureQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const symbol = query.symbol
    return getDataMany(
      `https://financialmodelingprep.com/stable/etf/asset-exposure?symbol=${symbol}&apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPEtfEquityExposureQueryParams,
    data: Record<string, unknown>[],
  ): FMPEtfEquityExposureData[] {
    const results = data.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      // Normalize weight from percent to decimal
      if (typeof aliased.weight === 'number') {
        aliased.weight = aliased.weight / 100
      }
      return FMPEtfEquityExposureDataSchema.parse(aliased)
    })
    // Sort by market_value descending (matching Python)
    return results.sort((a, b) => (Number(b.market_value ?? 0)) - (Number(a.market_value ?? 0)))
  }
}
