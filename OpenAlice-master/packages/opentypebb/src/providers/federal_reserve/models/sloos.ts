/**
 * Federal Reserve SLOOS (Senior Loan Officer Opinion Survey) Fetcher.
 * Uses FRED series: DRTSCILM (C&I Loan Tightening), DRTSCLCC (Consumer Loan Tightening).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { SloosQueryParamsSchema, SloosDataSchema } from '../../../standard-models/sloos.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredMultiSeries, multiSeriesToRecords, getFredApiKey } from '../utils/fred-helpers.js'

export const FedSloosQueryParamsSchema = SloosQueryParamsSchema
export type FedSloosQueryParams = z.infer<typeof FedSloosQueryParamsSchema>

const SERIES = ['DRTSCILM', 'DRTSCLCC']
const FIELD_MAP: Record<string, string> = {
  DRTSCILM: 'ci_loan_tightening',
  DRTSCLCC: 'consumer_loan_tightening',
}

export class FedSloosFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedSloosQueryParams {
    return FedSloosQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedSloosQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const dataMap = await fetchFredMultiSeries(SERIES, apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })

    const records = multiSeriesToRecords(dataMap, FIELD_MAP)
    if (records.length === 0) throw new EmptyDataError('No SLOOS data found.')
    return records
  }

  static override transformData(
    _query: FedSloosQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => SloosDataSchema.parse(d))
  }
}
