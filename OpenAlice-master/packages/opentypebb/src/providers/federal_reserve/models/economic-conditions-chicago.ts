/**
 * Federal Reserve Chicago Fed National Activity Index Fetcher.
 * Uses FRED series: CFNAI (CFNAI), CFNAIMA3 (3-month moving average).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EconomicConditionsChicagoQueryParamsSchema, EconomicConditionsChicagoDataSchema } from '../../../standard-models/economic-conditions-chicago.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredMultiSeries, multiSeriesToRecords, getFredApiKey } from '../utils/fred-helpers.js'

export const FedChicagoQueryParamsSchema = EconomicConditionsChicagoQueryParamsSchema
export type FedChicagoQueryParams = z.infer<typeof FedChicagoQueryParamsSchema>

const SERIES = ['CFNAI', 'CFNAIMA3']
const FIELD_MAP: Record<string, string> = {
  CFNAI: 'cfnai',
  CFNAIMA3: 'cfnai_ma3',
}

export class FedEconomicConditionsChicagoFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedChicagoQueryParams {
    return FedChicagoQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedChicagoQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const dataMap = await fetchFredMultiSeries(SERIES, apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })

    const records = multiSeriesToRecords(dataMap, FIELD_MAP)
    if (records.length === 0) throw new EmptyDataError('No Chicago Fed data found.')
    return records
  }

  static override transformData(
    _query: FedChicagoQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => EconomicConditionsChicagoDataSchema.parse(d))
  }
}
