/**
 * EconDB Available Indicators Model.
 * Maps to: openbb_econdb/models/available_indicators.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { AvailableIndicatorsDataSchema } from '../../../standard-models/available-indicators.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'

export const EconDBAvailableIndicatorsQueryParamsSchema = z.object({}).passthrough()
export type EconDBAvailableIndicatorsQueryParams = z.infer<typeof EconDBAvailableIndicatorsQueryParamsSchema>
export type EconDBAvailableIndicatorsData = z.infer<typeof AvailableIndicatorsDataSchema>

const ECONDB_BASE = 'https://www.econdb.com/api/series/?format=json'

export class EconDBAvailableIndicatorsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): EconDBAvailableIndicatorsQueryParams {
    return EconDBAvailableIndicatorsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    _query: EconDBAvailableIndicatorsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const token = credentials?.econdb_api_key ?? ''
    const url = token ? `${ECONDB_BASE}&token=${token}` : ECONDB_BASE

    try {
      const data = await amakeRequest<Record<string, unknown>>(url)
      const results = (data.results ?? data) as Record<string, unknown>[]
      if (!Array.isArray(results) || results.length === 0) throw new EmptyDataError()
      return results
    } catch (err) {
      if (err instanceof EmptyDataError) throw err
      throw new EmptyDataError(`Failed to fetch EconDB indicators: ${err}`)
    }
  }

  static override transformData(
    _query: EconDBAvailableIndicatorsQueryParams,
    data: Record<string, unknown>[],
  ): EconDBAvailableIndicatorsData[] {
    return data.map(d => AvailableIndicatorsDataSchema.parse({
      symbol_root: d.ticker ?? d.symbol_root ?? null,
      symbol: d.ticker ?? d.symbol ?? null,
      country: d.geography?.toString() ?? d.country ?? null,
      iso: d.iso ?? null,
      description: d.description ?? d.name ?? null,
      frequency: d.frequency ?? null,
    }))
  }
}
