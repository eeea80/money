/**
 * Federal Reserve Nonfarm Payrolls Fetcher.
 * Uses FRED series: PAYEMS (Total Nonfarm), USPRIV (Private), USGOVT (Government).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { NonfarmPayrollsQueryParamsSchema, NonfarmPayrollsDataSchema } from '../../../standard-models/nonfarm-payrolls.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredMultiSeries, multiSeriesToRecords, getFredApiKey } from '../utils/fred-helpers.js'

export const FedNonfarmPayrollsQueryParamsSchema = NonfarmPayrollsQueryParamsSchema
export type FedNonfarmPayrollsQueryParams = z.infer<typeof FedNonfarmPayrollsQueryParamsSchema>

const SERIES = ['PAYEMS', 'USPRIV', 'USGOVT']
const FIELD_MAP: Record<string, string> = {
  PAYEMS: 'total_nonfarm',
  USPRIV: 'private_sector',
  USGOVT: 'government',
}

export class FedNonfarmPayrollsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedNonfarmPayrollsQueryParams {
    return FedNonfarmPayrollsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedNonfarmPayrollsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const dataMap = await fetchFredMultiSeries(SERIES, apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })

    const records = multiSeriesToRecords(dataMap, FIELD_MAP)
    if (records.length === 0) throw new EmptyDataError('No nonfarm payrolls data found.')
    return records
  }

  static override transformData(
    _query: FedNonfarmPayrollsQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => NonfarmPayrollsDataSchema.parse(d))
  }
}
