/**
 * FMP ETF Countries Model.
 * Maps to: openbb_fmp/models/etf_countries.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EtfCountriesQueryParamsSchema, EtfCountriesDataSchema } from '../../../standard-models/etf-countries.js'
import { getDataMany } from '../utils/helpers.js'

export const FMPEtfCountriesQueryParamsSchema = EtfCountriesQueryParamsSchema
export type FMPEtfCountriesQueryParams = z.infer<typeof FMPEtfCountriesQueryParamsSchema>

export const FMPEtfCountriesDataSchema = EtfCountriesDataSchema.passthrough()
export type FMPEtfCountriesData = z.infer<typeof FMPEtfCountriesDataSchema>

export class FMPEtfCountriesFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEtfCountriesQueryParams {
    return FMPEtfCountriesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEtfCountriesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const symbol = query.symbol
    return getDataMany(
      `https://financialmodelingprep.com/stable/etf/country-weightings?symbol=${symbol}&apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPEtfCountriesQueryParams,
    data: Record<string, unknown>[],
  ): FMPEtfCountriesData[] {
    // FMP returns weightPercentage as a string like "50.25%"
    // Python source parses this and normalizes (multiply by 0.01)
    const results: FMPEtfCountriesData[] = []
    for (const d of data) {
      const raw = d.weightPercentage
      let weight = 0
      if (typeof raw === 'string') {
        weight = parseFloat(raw.replace('%', ''))
        if (isNaN(weight)) weight = 0
      } else if (typeof raw === 'number') {
        weight = raw
      }
      // Filter out zero weights
      if (weight === 0) continue
      // Normalize: percentage points → decimal-like normalized (match Python: * 0.01)
      weight = weight / 100
      results.push(
        EtfCountriesDataSchema.parse({
          ...d,
          weight,
          country: d.country ?? '',
        }),
      )
    }
    return results
  }
}
