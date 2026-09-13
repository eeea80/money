/**
 * EIA Short-Term Energy Outlook (STEO) Fetcher.
 * Uses EIA Open Data API v2.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { ShortTermEnergyOutlookQueryParamsSchema, ShortTermEnergyOutlookDataSchema } from '../../../standard-models/short-term-energy-outlook.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { resolveKeyedOrigin } from '../../../core/provider/utils/hub-proxy.js'

export const EIAShortTermEnergyOutlookQueryParamsSchema = ShortTermEnergyOutlookQueryParamsSchema
export type EIAShortTermEnergyOutlookQueryParams = z.infer<typeof EIAShortTermEnergyOutlookQueryParamsSchema>

const EIA_STEO_PATH = '/v2/steo/data'

// Map categories to EIA STEO series
const CATEGORY_SERIES: Record<string, { series: string; unit: string }> = {
  crude_oil_price: { series: 'BREPUUS', unit: 'Dollars per Barrel' },
  gasoline_price: { series: 'MGWHUUS', unit: 'Dollars per Gallon' },
  natural_gas_price: { series: 'NGHHUUS', unit: 'Dollars per MMBtu' },
  crude_oil_production: { series: 'PAPRPUS', unit: 'Million Barrels per Day' },
  petroleum_consumption: { series: 'PATCPUS', unit: 'Million Barrels per Day' },
}

interface EiaSteoResponse {
  response?: {
    data?: Array<{
      period: string
      // EIA API serialises numeric observations as strings ("75.10"), with
      // null only for missing periods. Coerce in extractData; the schema
      // expects number.
      value: string | number | null
      seriesDescription?: string
    }>
  }
}

export class EIAShortTermEnergyOutlookFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): EIAShortTermEnergyOutlookQueryParams {
    return EIAShortTermEnergyOutlookQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: EIAShortTermEnergyOutlookQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const { key: apiKey, origin } = resolveKeyedOrigin(
      credentials?.eia_api_key ?? credentials?.api_key, 'https://api.eia.gov', 'eia')
    const catInfo = CATEGORY_SERIES[query.category]
    if (!catInfo) throw new EmptyDataError(`Unknown STEO category: ${query.category}`)

    // EIA API v2 takes PHP-style bracket params, not JSON-encoded sort —
    // see https://www.eia.gov/opendata/documentation.php. The JSON form
    // is silently rejected with HTTP 403 on most endpoints.
    const params = new URLSearchParams({
      frequency: 'monthly',
      'data[0]': 'value',
      'facets[seriesId][]': catInfo.series,
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      length: '120', // ~10 years of monthly data
    })

    if (query.start_date) params.set('start', query.start_date.slice(0, 7)) // YYYY-MM
    if (query.end_date) params.set('end', query.end_date.slice(0, 7))
    if (apiKey) params.set('api_key', apiKey)

    const url = `${origin}${EIA_STEO_PATH}?${params.toString()}`
    const data = await amakeRequest<EiaSteoResponse>(url)

    // Determine current date to flag forecasts
    const now = new Date()
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const results: Record<string, unknown>[] = []
    for (const obs of data.response?.data ?? []) {
      if (obs.value == null) continue
      const value = typeof obs.value === 'string' ? parseFloat(obs.value) : obs.value
      if (Number.isNaN(value)) continue
      results.push({
        date: `${obs.period}-01`,
        value,
        category: query.category,
        unit: catInfo.unit,
        forecast: obs.period > currentPeriod,
      })
    }

    if (results.length === 0) throw new EmptyDataError('No EIA STEO data found.')
    return results
  }

  static override transformData(
    _query: EIAShortTermEnergyOutlookQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => ShortTermEnergyOutlookDataSchema.parse(d))
  }
}
