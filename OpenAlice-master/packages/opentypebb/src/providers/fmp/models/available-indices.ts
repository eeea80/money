/**
 * FMP Available Indices Model.
 * Maps to: openbb_fmp/models/available_indices.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { AvailableIndicesQueryParamsSchema, AvailableIndicesDataSchema } from '../../../standard-models/available-indices.js'
import { getDataMany } from '../utils/helpers.js'

export const FMPAvailableIndicesQueryParamsSchema = AvailableIndicesQueryParamsSchema
export type FMPAvailableIndicesQueryParams = z.infer<typeof FMPAvailableIndicesQueryParamsSchema>

export const FMPAvailableIndicesDataSchema = AvailableIndicesDataSchema
export type FMPAvailableIndicesData = z.infer<typeof FMPAvailableIndicesDataSchema>

export class FMPAvailableIndicesFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPAvailableIndicesQueryParams {
    return FMPAvailableIndicesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    _query: FMPAvailableIndicesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(
      `https://financialmodelingprep.com/stable/index-list?apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPAvailableIndicesQueryParams,
    data: Record<string, unknown>[],
  ): FMPAvailableIndicesData[] {
    return data.map(d => FMPAvailableIndicesDataSchema.parse(d))
  }
}
