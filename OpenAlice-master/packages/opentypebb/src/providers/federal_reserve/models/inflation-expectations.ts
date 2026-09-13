/**
 * Federal Reserve Inflation Expectations Fetcher.
 * Uses FRED series: MICH (Michigan 1y), MICH5Y (Michigan 5y),
 * T5YIE (5y Breakeven), T10YIE (10y Breakeven).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { InflationExpectationsQueryParamsSchema, InflationExpectationsDataSchema } from '../../../standard-models/inflation-expectations.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredMultiSeries, multiSeriesToRecords, getFredApiKey } from '../utils/fred-helpers.js'

export const FedInflationExpectationsQueryParamsSchema = InflationExpectationsQueryParamsSchema
export type FedInflationExpectationsQueryParams = z.infer<typeof FedInflationExpectationsQueryParamsSchema>

const SERIES = ['MICH', 'T5YIE', 'T10YIE']
const FIELD_MAP: Record<string, string> = {
  MICH: 'michigan_1y',
  T5YIE: 'breakeven_5y',
  T10YIE: 'breakeven_10y',
}

export class FedInflationExpectationsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedInflationExpectationsQueryParams {
    return FedInflationExpectationsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedInflationExpectationsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const dataMap = await fetchFredMultiSeries(SERIES, apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })

    const records = multiSeriesToRecords(dataMap, FIELD_MAP)
    if (records.length === 0) throw new EmptyDataError('No inflation expectations data found.')
    return records
  }

  static override transformData(
    _query: FedInflationExpectationsQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => InflationExpectationsDataSchema.parse(d))
  }
}
