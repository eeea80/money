/**
 * Federal Reserve Unemployment Fetcher.
 * Uses FRED series: UNRATE (U-3), U6RATE (U-6).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { UnemploymentQueryParamsSchema, UnemploymentDataSchema } from '../../../standard-models/unemployment.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredSeries, getFredApiKey } from '../utils/fred-helpers.js'

export const FedUnemploymentQueryParamsSchema = UnemploymentQueryParamsSchema
export type FedUnemploymentQueryParams = z.infer<typeof FedUnemploymentQueryParamsSchema>

export class FedUnemploymentFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedUnemploymentQueryParams {
    return FedUnemploymentQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedUnemploymentQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const observations = await fetchFredSeries('UNRATE', apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })

    if (observations.length === 0) throw new EmptyDataError('No unemployment data found.')
    return observations.map(o => ({
      date: o.date,
      country: 'United States',
      value: parseFloat(o.value),
    }))
  }

  static override transformData(
    query: FedUnemploymentQueryParams,
    data: Record<string, unknown>[],
  ) {
    if (data.length === 0) throw new EmptyDataError()
    let filtered = data
    if (query.start_date) filtered = filtered.filter(d => String(d.date) >= query.start_date!)
    if (query.end_date) filtered = filtered.filter(d => String(d.date) <= query.end_date!)
    return filtered
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => UnemploymentDataSchema.parse(d))
  }
}
