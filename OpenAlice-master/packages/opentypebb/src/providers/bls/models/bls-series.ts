/**
 * BLS Series Fetcher.
 * Uses BLS Public Data API v2.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { BlsSeriesQueryParamsSchema, BlsSeriesDataSchema } from '../../../standard-models/bls-series.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { resolveKeyedOrigin } from '../../../core/provider/utils/hub-proxy.js'

export const BLSBlsSeriesQueryParamsSchema = BlsSeriesQueryParamsSchema
export type BLSBlsSeriesQueryParams = z.infer<typeof BLSBlsSeriesQueryParamsSchema>

const BLS_TIMESERIES_PATH = '/publicAPI/v2/timeseries/data/'

interface BlsApiResponse {
  status: string
  Results?: {
    series?: Array<{
      seriesID: string
      data: Array<{
        year: string
        period: string
        value: string
        periodName: string
      }>
    }>
  }
}

export class BLSBlsSeriesFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): BLSBlsSeriesQueryParams {
    return BLSBlsSeriesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: BLSBlsSeriesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const seriesIds = query.symbol.split(',').map(s => s.trim()).filter(Boolean)
    const { key: apiKey, origin } = resolveKeyedOrigin(
      credentials?.bls_api_key, 'https://api.bls.gov', 'bls')

    const startYear = query.start_date ? query.start_date.slice(0, 4) : String(new Date().getFullYear() - 10)
    const endYear = query.end_date ? query.end_date.slice(0, 4) : String(new Date().getFullYear())

    const body: Record<string, unknown> = {
      seriesid: seriesIds,
      startyear: startYear,
      endyear: endYear,
    }
    if (apiKey) body.registrationkey = apiKey

    const data = await amakeRequest<BlsApiResponse>(`${origin}${BLS_TIMESERIES_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const results: Record<string, unknown>[] = []
    for (const series of data.Results?.series ?? []) {
      for (const obs of series.data) {
        // BLS returns '-' (or other non-numeric) for unavailable observations —
        // e.g. the 2025-10 UNRATE dropout due to "lapse in appropriations".
        // Skip rather than push NaN, which the schema would reject.
        const value = parseFloat(obs.value)
        if (Number.isNaN(value)) continue
        // Convert period M01..M12 to month
        const monthMatch = obs.period.match(/M(\d{2})/)
        const month = monthMatch ? monthMatch[1] : '01'
        const date = `${obs.year}-${month}-01`
        results.push({
          date,
          series_id: series.seriesID,
          value,
          period: obs.period,
        })
      }
    }

    if (results.length === 0) throw new EmptyDataError('No BLS series data found.')
    return results
  }

  static override transformData(
    _query: BLSBlsSeriesQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => BlsSeriesDataSchema.parse(d))
  }
}
