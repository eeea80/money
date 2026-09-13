/**
 * EIA Petroleum Status Report Fetcher.
 * Uses EIA Open Data API v2.
 * API docs: https://www.eia.gov/opendata/
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { PetroleumStatusReportQueryParamsSchema, PetroleumStatusReportDataSchema } from '../../../standard-models/petroleum-status-report.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { resolveKeyedOrigin } from '../../../core/provider/utils/hub-proxy.js'

export const EIAPetroleumStatusReportQueryParamsSchema = PetroleumStatusReportQueryParamsSchema
export type EIAPetroleumStatusReportQueryParams = z.infer<typeof EIAPetroleumStatusReportQueryParamsSchema>

const EIA_PETROLEUM_PATH = '/v2/petroleum/sum/sndw/data'

// Map categories to EIA series IDs
const CATEGORY_SERIES: Record<string, { series: string; unit: string }> = {
  crude_oil_production: { series: 'WCRFPUS2', unit: 'Thousand Barrels per Day' },
  crude_oil_stocks: { series: 'WCESTUS1', unit: 'Thousand Barrels' },
  gasoline_stocks: { series: 'WGTSTUS1', unit: 'Thousand Barrels' },
  distillate_stocks: { series: 'WDISTUS1', unit: 'Thousand Barrels' },
  refinery_utilization: { series: 'WPULEUS3', unit: 'Percent' },
}

interface EiaResponse {
  response?: {
    data?: Array<{
      period: string
      // EIA API serialises numeric observations as strings ("75.10"), with
      // null only for missing periods. Coerce in extractData; the schema
      // expects number.
      value: string | number | null
      'series-description'?: string
    }>
  }
}

export class EIAPetroleumStatusReportFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): EIAPetroleumStatusReportQueryParams {
    return EIAPetroleumStatusReportQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: EIAPetroleumStatusReportQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const { key: apiKey, origin } = resolveKeyedOrigin(
      credentials?.eia_api_key ?? credentials?.api_key, 'https://api.eia.gov', 'eia')
    const catInfo = CATEGORY_SERIES[query.category]
    if (!catInfo) throw new EmptyDataError(`Unknown category: ${query.category}`)

    // EIA API v2 takes PHP-style bracket params, not JSON-encoded sort —
    // see https://www.eia.gov/opendata/documentation.php. The JSON form
    // is silently rejected with HTTP 403 on most endpoints.
    const params = new URLSearchParams({
      frequency: 'weekly',
      'data[0]': 'value',
      'facets[series][]': catInfo.series,
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      length: '260', // ~5 years of weekly data
    })

    if (query.start_date) params.set('start', query.start_date)
    if (query.end_date) params.set('end', query.end_date)
    if (apiKey) params.set('api_key', apiKey)

    const url = `${origin}${EIA_PETROLEUM_PATH}?${params.toString()}`
    const data = await amakeRequest<EiaResponse>(url)

    const results: Record<string, unknown>[] = []
    for (const obs of data.response?.data ?? []) {
      if (obs.value == null) continue
      const value = typeof obs.value === 'string' ? parseFloat(obs.value) : obs.value
      if (Number.isNaN(value)) continue
      results.push({
        date: obs.period,
        value,
        category: query.category,
        unit: catInfo.unit,
      })
    }

    if (results.length === 0) throw new EmptyDataError('No EIA petroleum data found.')
    return results
  }

  static override transformData(
    _query: EIAPetroleumStatusReportQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => PetroleumStatusReportDataSchema.parse(d))
  }
}
