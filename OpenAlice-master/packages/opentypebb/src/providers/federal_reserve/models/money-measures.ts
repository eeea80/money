/**
 * Federal Reserve Money Measures Fetcher.
 * Uses FRED series: M1SL (M1), M2SL (M2) — seasonally adjusted.
 * Or: M1NS, M2NS — not adjusted.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { MoneyMeasuresQueryParamsSchema, MoneyMeasuresDataSchema } from '../../../standard-models/money-measures.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredMultiSeries, multiSeriesToRecords, getFredApiKey } from '../utils/fred-helpers.js'

export const FedMoneyMeasuresQueryParamsSchema = MoneyMeasuresQueryParamsSchema
export type FedMoneyMeasuresQueryParams = z.infer<typeof FedMoneyMeasuresQueryParamsSchema>

export class FedMoneyMeasuresFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedMoneyMeasuresQueryParams {
    return FedMoneyMeasuresQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedMoneyMeasuresQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const adjusted = query.adjusted !== false
    const m1Series = adjusted ? 'M1SL' : 'M1NS'
    const m2Series = adjusted ? 'M2SL' : 'M2NS'

    const dataMap = await fetchFredMultiSeries([m1Series, m2Series], apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })

    const fieldMap: Record<string, string> = {
      [m1Series]: 'm1',
      [m2Series]: 'm2',
    }
    const records = multiSeriesToRecords(dataMap, fieldMap)
    if (records.length === 0) throw new EmptyDataError('No money measures data found.')
    return records
  }

  static override transformData(
    _query: FedMoneyMeasuresQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => MoneyMeasuresDataSchema.parse(d))
  }
}
