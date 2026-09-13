/**
 * Federal Reserve NY Manufacturing Outlook (Empire State) Fetcher.
 * Uses FRED series: GACDISA066MSFRBNY (General Business Conditions).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { ManufacturingOutlookNYQueryParamsSchema, ManufacturingOutlookNYDataSchema } from '../../../standard-models/manufacturing-outlook-ny.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredSeries, getFredApiKey } from '../utils/fred-helpers.js'

export const FedManufacturingOutlookNYQueryParamsSchema = ManufacturingOutlookNYQueryParamsSchema
export type FedManufacturingOutlookNYQueryParams = z.infer<typeof FedManufacturingOutlookNYQueryParamsSchema>

export class FedManufacturingOutlookNYFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedManufacturingOutlookNYQueryParams {
    return FedManufacturingOutlookNYQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedManufacturingOutlookNYQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const observations = await fetchFredSeries('GACDISA066MSFRBNY', apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })
    if (observations.length === 0) throw new EmptyDataError('No Empire State Manufacturing data found.')
    return observations.map(o => ({
      date: o.date,
      general_business_conditions: parseFloat(o.value),
    }))
  }

  static override transformData(
    _query: FedManufacturingOutlookNYQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => ManufacturingOutlookNYDataSchema.parse(d))
  }
}
