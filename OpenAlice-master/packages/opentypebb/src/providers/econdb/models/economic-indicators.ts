/**
 * EconDB Economic Indicators Model.
 * Maps to: openbb_econdb/models/economic_indicators.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EconomicIndicatorsDataSchema } from '../../../standard-models/economic-indicators.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'

export const EconDBEconomicIndicatorsQueryParamsSchema = z.object({
  symbol: z.string().describe('Indicator symbol (e.g., GDP, CPI, URATE).'),
  country: z.string().nullable().default(null).describe('Country to filter by.'),
  frequency: z.string().nullable().default(null).describe('Data frequency.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type EconDBEconomicIndicatorsQueryParams = z.infer<typeof EconDBEconomicIndicatorsQueryParamsSchema>
export type EconDBEconomicIndicatorsData = z.infer<typeof EconomicIndicatorsDataSchema>

export class EconDBEconomicIndicatorsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): EconDBEconomicIndicatorsQueryParams {
    return EconDBEconomicIndicatorsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: EconDBEconomicIndicatorsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const token = credentials?.econdb_api_key ?? ''
    const tokenParam = token ? `&token=${token}` : ''
    let url = `https://www.econdb.com/api/series/${query.symbol}/?format=json${tokenParam}`

    try {
      const data = await amakeRequest<Record<string, unknown>>(url)
      const values = (data.data ?? data.results ?? []) as Record<string, unknown>[]

      if (!Array.isArray(values) || values.length === 0) {
        // Try alternative format
        const dates = data.dates as string[] | undefined
        const vals = data.values as number[] | undefined
        if (dates && vals) {
          return dates.map((d, i) => ({
            date: d,
            symbol: query.symbol,
            country: query.country,
            value: vals[i],
          }))
        }
        throw new EmptyDataError()
      }

      return values.map(v => ({
        ...v,
        symbol: query.symbol,
        country: query.country ?? v.country,
      }))
    } catch (err) {
      if (err instanceof EmptyDataError) throw err
      throw new EmptyDataError(`Failed to fetch EconDB indicators: ${err}`)
    }
  }

  static override transformData(
    query: EconDBEconomicIndicatorsQueryParams,
    data: Record<string, unknown>[],
  ): EconDBEconomicIndicatorsData[] {
    let filtered = data
    if (query.start_date) filtered = filtered.filter(d => String(d.date) >= query.start_date!)
    if (query.end_date) filtered = filtered.filter(d => String(d.date) <= query.end_date!)
    return filtered
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => EconomicIndicatorsDataSchema.parse(d))
  }
}
