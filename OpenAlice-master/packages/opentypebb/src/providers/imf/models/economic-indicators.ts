/**
 * IMF Economic Indicators Model.
 * Maps to: openbb_imf/models/economic_indicators.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EconomicIndicatorsDataSchema } from '../../../standard-models/economic-indicators.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { nativeFetch } from '../../../core/provider/utils/helpers.js'

export const IMFEconomicIndicatorsQueryParamsSchema = z.object({
  symbol: z.string().describe('IMF dataset/indicator code (e.g., IFS, BOP, GFSR).'),
  country: z.string().nullable().default(null).describe('Country ISO2 code.'),
  frequency: z.string().nullable().default(null).describe('Data frequency (A, Q, M).'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type IMFEconomicIndicatorsQueryParams = z.infer<typeof IMFEconomicIndicatorsQueryParamsSchema>
export type IMFEconomicIndicatorsData = z.infer<typeof EconomicIndicatorsDataSchema>

export class IMFEconomicIndicatorsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): IMFEconomicIndicatorsQueryParams {
    return IMFEconomicIndicatorsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: IMFEconomicIndicatorsQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const freq = query.frequency ?? 'A'
    const country = query.country ?? 'US'
    const url = `https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/${query.symbol}/${freq}.${country}`

    try {
      const resp = await nativeFetch(url, { timeoutMs: 30000 })
      if (resp.status !== 200) throw new EmptyDataError(`IMF API returned ${resp.status}`)
      const data = JSON.parse(resp.text) as Record<string, unknown>
      const dataset = data.CompactData as Record<string, unknown>
      const dataSet = dataset?.DataSet as Record<string, unknown>
      let series = dataSet?.Series as Record<string, unknown> | Record<string, unknown>[]

      if (!series) throw new EmptyDataError()
      if (!Array.isArray(series)) series = [series]

      const results: Record<string, unknown>[] = []
      for (const s of series) {
        const indicator = s['@INDICATOR'] as string ?? query.symbol
        let obs = (s.Obs ?? []) as Record<string, unknown> | Record<string, unknown>[]
        if (!Array.isArray(obs)) obs = [obs]

        for (const o of obs) {
          const period = o['@TIME_PERIOD'] as string
          const value = parseFloat(o['@OBS_VALUE'] as string)
          if (period && !isNaN(value)) {
            const date = period.length === 7 ? period + '-01' : period.length === 4 ? period + '-01-01' : period
            results.push({
              date,
              symbol_root: query.symbol,
              symbol: `${query.symbol}.${indicator}`,
              country: query.country,
              value,
            })
          }
        }
      }

      return results
    } catch (err) {
      if (err instanceof EmptyDataError) throw err
      throw new EmptyDataError(`Failed to fetch IMF data: ${err}`)
    }
  }

  static override transformData(
    query: IMFEconomicIndicatorsQueryParams,
    data: Record<string, unknown>[],
  ): IMFEconomicIndicatorsData[] {
    if (data.length === 0) throw new EmptyDataError()
    let filtered = data
    if (query.start_date) filtered = filtered.filter(d => String(d.date) >= query.start_date!)
    if (query.end_date) filtered = filtered.filter(d => String(d.date) <= query.end_date!)
    return filtered
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => EconomicIndicatorsDataSchema.parse(d))
  }
}
