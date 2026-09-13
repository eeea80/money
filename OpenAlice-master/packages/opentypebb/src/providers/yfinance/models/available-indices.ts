/**
 * Yahoo Finance Available Indices Model.
 * Maps to: openbb_yfinance/models/available_indices.py
 *
 * Simply returns the INDICES reference table as structured data.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { AvailableIndicesQueryParamsSchema, AvailableIndicesDataSchema } from '../../../standard-models/available-indices.js'
import { INDICES } from '../utils/references.js'

export const YFinanceAvailableIndicesQueryParamsSchema = AvailableIndicesQueryParamsSchema
export type YFinanceAvailableIndicesQueryParams = z.infer<typeof YFinanceAvailableIndicesQueryParamsSchema>

export const YFinanceAvailableIndicesDataSchema = AvailableIndicesDataSchema.extend({
  code: z.string().describe('ID code for keying the index in the OpenBB Terminal.'),
}).passthrough()
export type YFinanceAvailableIndicesData = z.infer<typeof YFinanceAvailableIndicesDataSchema>

export class YFinanceAvailableIndicesFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFinanceAvailableIndicesQueryParams {
    return YFinanceAvailableIndicesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    _query: YFinanceAvailableIndicesQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const records: Record<string, unknown>[] = []
    for (const [code, entry] of Object.entries(INDICES)) {
      records.push({
        code,
        name: entry.name,
        symbol: entry.ticker,
      })
    }
    return records
  }

  static override transformData(
    _query: YFinanceAvailableIndicesQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceAvailableIndicesData[] {
    return data.map(d => YFinanceAvailableIndicesDataSchema.parse(d))
  }
}
