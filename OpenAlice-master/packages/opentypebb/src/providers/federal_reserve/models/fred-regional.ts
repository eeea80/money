/**
 * Federal Reserve FRED Regional (GeoFRED) Fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { FredRegionalQueryParamsSchema, FredRegionalDataSchema } from '../../../standard-models/fred-regional.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fredRegionalApi, getFredApiKey } from '../utils/fred-helpers.js'

export const FedFredRegionalQueryParamsSchema = FredRegionalQueryParamsSchema
export type FedFredRegionalQueryParams = z.infer<typeof FedFredRegionalQueryParamsSchema>

export class FedFredRegionalFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedFredRegionalQueryParams {
    return FedFredRegionalQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedFredRegionalQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const results = await fredRegionalApi(query.symbol, apiKey, {
      regionType: query.region_type,
      date: query.date ?? undefined,
      startDate: query.start_date ?? undefined,
      frequency: query.frequency ?? undefined,
    })
    if (results.length === 0) throw new EmptyDataError('No GeoFRED data found.')
    return results
  }

  static override transformData(
    _query: FedFredRegionalQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => FredRegionalDataSchema.parse(d))
  }
}
