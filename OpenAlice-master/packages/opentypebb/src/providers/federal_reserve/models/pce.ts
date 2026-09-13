/**
 * Federal Reserve PCE Fetcher.
 * Uses FRED series: PCEPI (PCE Price Index), PCEPILFE (Core PCE).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { PersonalConsumptionExpendituresQueryParamsSchema, PersonalConsumptionExpendituresDataSchema } from '../../../standard-models/pce.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredMultiSeries, multiSeriesToRecords, getFredApiKey } from '../utils/fred-helpers.js'

export const FedPCEQueryParamsSchema = PersonalConsumptionExpendituresQueryParamsSchema
export type FedPCEQueryParams = z.infer<typeof FedPCEQueryParamsSchema>

export class FedPCEFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedPCEQueryParams {
    return FedPCEQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedPCEQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const dataMap = await fetchFredMultiSeries(['PCEPI', 'PCEPILFE'], apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })

    const records = multiSeriesToRecords(dataMap, {
      PCEPI: 'pce',
      PCEPILFE: 'core_pce',
    })
    if (records.length === 0) throw new EmptyDataError('No PCE data found.')
    return records
  }

  static override transformData(
    _query: FedPCEQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => PersonalConsumptionExpendituresDataSchema.parse(d))
  }
}
