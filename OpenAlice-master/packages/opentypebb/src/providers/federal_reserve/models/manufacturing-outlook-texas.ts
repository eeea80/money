/**
 * Federal Reserve Dallas Fed Manufacturing Outlook Fetcher.
 * Uses FRED series: DALLASMANOUTGEN (General Activity).
 * Note: actual FRED ID may vary; falls back to BCTDAL for Dallas Fed data.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { ManufacturingOutlookTexasQueryParamsSchema, ManufacturingOutlookTexasDataSchema } from '../../../standard-models/manufacturing-outlook-texas.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredSeries, getFredApiKey } from '../utils/fred-helpers.js'

export const FedManufacturingOutlookTexasQueryParamsSchema = ManufacturingOutlookTexasQueryParamsSchema
export type FedManufacturingOutlookTexasQueryParams = z.infer<typeof FedManufacturingOutlookTexasQueryParamsSchema>

export class FedManufacturingOutlookTexasFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedManufacturingOutlookTexasQueryParams {
    return FedManufacturingOutlookTexasQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedManufacturingOutlookTexasQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    // Dallas Fed Texas Manufacturing Outlook Survey — General Business Activity
    const observations = await fetchFredSeries('BCTDAL', apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })
    if (observations.length === 0) throw new EmptyDataError('No Dallas Fed Manufacturing data found.')
    return observations.map(o => ({
      date: o.date,
      general_activity: parseFloat(o.value),
    }))
  }

  static override transformData(
    _query: FedManufacturingOutlookTexasQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => ManufacturingOutlookTexasDataSchema.parse(d))
  }
}
