/**
 * Federal Reserve FRED Release Table Fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { FredReleaseTableQueryParamsSchema, FredReleaseTableDataSchema } from '../../../standard-models/fred-release-table.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fredReleaseTableApi, getFredApiKey } from '../utils/fred-helpers.js'

export const FedFredReleaseTableQueryParamsSchema = FredReleaseTableQueryParamsSchema
export type FedFredReleaseTableQueryParams = z.infer<typeof FedFredReleaseTableQueryParamsSchema>

export class FedFredReleaseTableFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedFredReleaseTableQueryParams {
    return FedFredReleaseTableQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedFredReleaseTableQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const results = await fredReleaseTableApi(query.release_id, apiKey, {
      elementId: query.element_id ?? undefined,
      date: query.date ?? undefined,
    })
    if (results.length === 0) throw new EmptyDataError('No release table data found.')
    return results
  }

  static override transformData(
    _query: FedFredReleaseTableQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => FredReleaseTableDataSchema.parse(d))
  }
}
