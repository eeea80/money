/**
 * FMP Historical Splits Model.
 * Maps to: openbb_fmp/models/historical_splits.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { HistoricalSplitsQueryParamsSchema, HistoricalSplitsDataSchema } from '../../../standard-models/historical-splits.js'
import { getDataMany } from '../utils/helpers.js'

export const FMPHistoricalSplitsQueryParamsSchema = HistoricalSplitsQueryParamsSchema
export type FMPHistoricalSplitsQueryParams = z.infer<typeof FMPHistoricalSplitsQueryParamsSchema>

export const FMPHistoricalSplitsDataSchema = HistoricalSplitsDataSchema.passthrough()
export type FMPHistoricalSplitsData = z.infer<typeof FMPHistoricalSplitsDataSchema>

export class FMPHistoricalSplitsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPHistoricalSplitsQueryParams {
    return FMPHistoricalSplitsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPHistoricalSplitsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(
      `https://financialmodelingprep.com/stable/splits?symbol=${query.symbol}&apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPHistoricalSplitsQueryParams,
    data: Record<string, unknown>[],
  ): FMPHistoricalSplitsData[] {
    return data.map(d => FMPHistoricalSplitsDataSchema.parse(d))
  }
}
