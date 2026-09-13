/**
 * IMF Available Indicators Model.
 * Maps to: openbb_imf/models/available_indicators.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { AvailableIndicatorsDataSchema } from '../../../standard-models/available-indicators.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { nativeFetch } from '../../../core/provider/utils/helpers.js'

export const IMFAvailableIndicatorsQueryParamsSchema = z.object({}).passthrough()
export type IMFAvailableIndicatorsQueryParams = z.infer<typeof IMFAvailableIndicatorsQueryParamsSchema>
export type IMFAvailableIndicatorsData = z.infer<typeof AvailableIndicatorsDataSchema>

export class IMFAvailableIndicatorsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): IMFAvailableIndicatorsQueryParams {
    return IMFAvailableIndicatorsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    _query: IMFAvailableIndicatorsQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    // IMF Dataflow endpoint lists available datasets
    const url = 'https://dataservices.imf.org/REST/SDMX_JSON.svc/Dataflow'

    try {
      const resp = await nativeFetch(url, { timeoutMs: 30000 })
      if (resp.status !== 200) throw new EmptyDataError(`IMF API returned ${resp.status}`)
      const data = JSON.parse(resp.text) as Record<string, unknown>
      const structure = data.Structure as Record<string, unknown>
      const dataflows = (structure?.Dataflows as Record<string, unknown>)?.Dataflow as Record<string, unknown>[]

      if (!Array.isArray(dataflows) || dataflows.length === 0) throw new EmptyDataError()

      return dataflows.map(df => ({
        symbol: (df.KeyFamilyRef as Record<string, unknown>)?.KeyFamilyID ?? df['@id'] ?? '',
        description: ((df.Name as Record<string, unknown>)?.['#text'] ?? df.Name ?? '') as string,
      }))
    } catch (err) {
      if (err instanceof EmptyDataError) throw err
      throw new EmptyDataError(`Failed to fetch IMF indicators: ${err}`)
    }
  }

  static override transformData(
    _query: IMFAvailableIndicatorsQueryParams,
    data: Record<string, unknown>[],
  ): IMFAvailableIndicatorsData[] {
    return data.map(d => AvailableIndicatorsDataSchema.parse({
      symbol: d.symbol ?? null,
      description: d.description ?? null,
    }))
  }
}
