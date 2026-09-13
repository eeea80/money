/**
 * Federal Reserve FRED Search Fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { FredSearchQueryParamsSchema, FredSearchDataSchema } from '../../../standard-models/fred-search.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fredSearchApi, getFredApiKey } from '../utils/fred-helpers.js'

export const FedFredSearchQueryParamsSchema = FredSearchQueryParamsSchema
export type FedFredSearchQueryParams = z.infer<typeof FedFredSearchQueryParamsSchema>

export class FedFredSearchFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedFredSearchQueryParams {
    return FedFredSearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedFredSearchQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const results = await fredSearchApi(query.query, apiKey, { limit: query.limit })
    if (results.length === 0) throw new EmptyDataError('No FRED series found.')
    return results.map(r => ({
      series_id: r.id,
      title: r.title,
      frequency: r.frequency_short || null,
      units: r.units_short || null,
      seasonal_adjustment: r.seasonal_adjustment_short || null,
      last_updated: r.last_updated || null,
      notes: r.notes || null,
    }))
  }

  static override transformData(
    _query: FedFredSearchQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => FredSearchDataSchema.parse(d))
  }
}
