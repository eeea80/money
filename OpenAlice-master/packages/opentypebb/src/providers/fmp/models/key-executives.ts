/**
 * FMP Key Executives Model.
 * Maps to: openbb_fmp/models/key_executives.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { KeyExecutivesQueryParamsSchema, KeyExecutivesDataSchema } from '../../../standard-models/key-executives.js'
import { getDataMany } from '../utils/helpers.js'

export const FMPKeyExecutivesQueryParamsSchema = KeyExecutivesQueryParamsSchema
export type FMPKeyExecutivesQueryParams = z.infer<typeof FMPKeyExecutivesQueryParamsSchema>

// extra="ignore" in Python → .strip() in Zod
export const FMPKeyExecutivesDataSchema = KeyExecutivesDataSchema.strip()
export type FMPKeyExecutivesData = z.infer<typeof FMPKeyExecutivesDataSchema>

export class FMPKeyExecutivesFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPKeyExecutivesQueryParams {
    return FMPKeyExecutivesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPKeyExecutivesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(
      `https://financialmodelingprep.com/stable/key-executives?symbol=${query.symbol}&apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPKeyExecutivesQueryParams,
    data: Record<string, unknown>[],
  ): FMPKeyExecutivesData[] {
    return data.map(d => FMPKeyExecutivesDataSchema.parse(d))
  }
}
