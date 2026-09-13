/**
 * Federal Reserve Primary Dealer Fails Fetcher.
 * Uses FRED series for delivery failures data.
 * Series: DTBSPCKF (Fails to Deliver), DTBSPCKR (Fails to Receive).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { PrimaryDealerFailsQueryParamsSchema, PrimaryDealerFailsDataSchema } from '../../../standard-models/primary-dealer-fails.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredMultiSeries, multiSeriesToRecords, getFredApiKey } from '../utils/fred-helpers.js'

export const FedPrimaryDealerFailsQueryParamsSchema = PrimaryDealerFailsQueryParamsSchema
export type FedPrimaryDealerFailsQueryParams = z.infer<typeof FedPrimaryDealerFailsQueryParamsSchema>

const SERIES = ['DTBSPCKF', 'DTBSPCKR']
const FIELD_MAP: Record<string, string> = {
  DTBSPCKF: 'fails_to_deliver',
  DTBSPCKR: 'fails_to_receive',
}

export class FedPrimaryDealerFailsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedPrimaryDealerFailsQueryParams {
    return FedPrimaryDealerFailsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedPrimaryDealerFailsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const dataMap = await fetchFredMultiSeries(SERIES, apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })

    const records = multiSeriesToRecords(dataMap, FIELD_MAP)
    if (records.length === 0) throw new EmptyDataError('No primary dealer fails data found.')
    return records
  }

  static override transformData(
    _query: FedPrimaryDealerFailsQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => PrimaryDealerFailsDataSchema.parse(d))
  }
}
