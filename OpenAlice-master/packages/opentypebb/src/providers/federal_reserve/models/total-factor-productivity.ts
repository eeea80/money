/**
 * Federal Reserve Total Factor Productivity Fetcher.
 * Uses FRED series: RTFPNAUSA632NRUG (Annual TFP at constant national prices for US).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { TotalFactorProductivityQueryParamsSchema, TotalFactorProductivityDataSchema } from '../../../standard-models/total-factor-productivity.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredSeries, getFredApiKey } from '../utils/fred-helpers.js'

export const FedTFPQueryParamsSchema = TotalFactorProductivityQueryParamsSchema
export type FedTFPQueryParams = z.infer<typeof FedTFPQueryParamsSchema>

export class FedTotalFactorProductivityFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedTFPQueryParams {
    return FedTFPQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedTFPQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const observations = await fetchFredSeries('RTFPNAUSA632NRUG', apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })
    if (observations.length === 0) throw new EmptyDataError('No TFP data found.')
    return observations.map(o => ({
      date: o.date,
      value: parseFloat(o.value),
    }))
  }

  static override transformData(
    _query: FedTFPQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => TotalFactorProductivityDataSchema.parse(d))
  }
}
