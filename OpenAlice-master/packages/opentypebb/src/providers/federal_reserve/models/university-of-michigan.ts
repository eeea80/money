/**
 * Federal Reserve University of Michigan Consumer Sentiment Fetcher.
 * Uses FRED series: UMCSENT (Sentiment), UMCSENT1 is not available, so we use
 * UMCSENT (Consumer Sentiment), CURRCOND (Current Conditions), EXPINF1YR + EXPINF5YR.
 * Actual FRED IDs: UMCSENT, UMCSENT (we approximate with available data).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { UniversityOfMichiganQueryParamsSchema, UniversityOfMichiganDataSchema } from '../../../standard-models/university-of-michigan.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredMultiSeries, multiSeriesToRecords, getFredApiKey } from '../utils/fred-helpers.js'

export const FedUMichQueryParamsSchema = UniversityOfMichiganQueryParamsSchema
export type FedUMichQueryParams = z.infer<typeof FedUMichQueryParamsSchema>

// FRED series for Michigan survey data
const SERIES = ['UMCSENT', 'MICH']
const FIELD_MAP: Record<string, string> = {
  UMCSENT: 'consumer_sentiment',
  MICH: 'inflation_expectation_1y',
}

export class FedUniversityOfMichiganFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedUMichQueryParams {
    return FedUMichQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedUMichQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getFredApiKey(credentials)
    const dataMap = await fetchFredMultiSeries(SERIES, apiKey, {
      startDate: query.start_date,
      endDate: query.end_date,
    })

    const records = multiSeriesToRecords(dataMap, FIELD_MAP)
    if (records.length === 0) throw new EmptyDataError('No University of Michigan data found.')
    return records
  }

  static override transformData(
    _query: FedUMichQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => UniversityOfMichiganDataSchema.parse(d))
  }
}
