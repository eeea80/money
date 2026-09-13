/**
 * Federal Reserve FRED Series Fetcher.
 * Fetches observations for one or more FRED series.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { FredSeriesQueryParamsSchema, FredSeriesDataSchema } from '../../../standard-models/fred-series.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredMultiSeries, multiSeriesToRecords, getFredApiKey } from '../utils/fred-helpers.js'

export const FedFredSeriesQueryParamsSchema = FredSeriesQueryParamsSchema
export type FedFredSeriesQueryParams = z.infer<typeof FedFredSeriesQueryParamsSchema>

export class FedFredSeriesFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedFredSeriesQueryParams {
    return FedFredSeriesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedFredSeriesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    if (!apiKey) {
      throw new Error('FRED API key required — set the fred provider key in Settings → Market Data (free at fred.stlouisfed.org).')
    }
    const seriesIds = query.symbol.split(',').map(s => s.trim()).filter(Boolean)
    if (seriesIds.length === 0) throw new EmptyDataError('No series IDs provided.')

    const dataMap = await fetchFredMultiSeries(seriesIds, apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
      limit: query.limit ?? undefined,
    })

    const records = multiSeriesToRecords(dataMap)
    if (records.length === 0) throw new EmptyDataError('No FRED series data found.')
    return records
  }

  static override transformData(
    _query: FedFredSeriesQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => FredSeriesDataSchema.parse(d))
  }
}
