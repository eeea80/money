/**
 * OECD Consumer Price Index Model.
 * Maps to: openbb_oecd/models/consumer_price_index.py
 *
 * Uses CSV format from OECD SDMX REST API (same as Python implementation).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { ConsumerPriceIndexDataSchema } from '../../../standard-models/consumer-price-index.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { nativeFetch } from '../../../core/provider/utils/helpers.js'
import { resolveCountryCodes } from '../utils/oecd-helpers.js'

export const OECDCPIQueryParamsSchema = z.object({
  country: z.string().default('united_states').describe('The country to get data for.'),
  transform: z.string().default('yoy').describe('Transformation: yoy, period, index.'),
  frequency: z.enum(['annual', 'quarter', 'monthly']).default('monthly').describe('Data frequency.'),
  harmonized: z.boolean().default(false).describe('If true, returns harmonized data.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type OECDCPIQueryParams = z.infer<typeof OECDCPIQueryParamsSchema>
export type OECDCPIData = z.infer<typeof ConsumerPriceIndexDataSchema>

const COUNTRY_MAP: Record<string, string> = {
  united_states: 'USA', united_kingdom: 'GBR', japan: 'JPN', germany: 'DEU',
  france: 'FRA', italy: 'ITA', canada: 'CAN', australia: 'AUS',
  south_korea: 'KOR', mexico: 'MEX', brazil: 'BRA', china: 'CHN',
  india: 'IND', turkey: 'TUR', south_africa: 'ZAF', russia: 'RUS',
  spain: 'ESP', netherlands: 'NLD', switzerland: 'CHE', sweden: 'SWE',
  norway: 'NOR', denmark: 'DNK', finland: 'FIN', belgium: 'BEL',
  austria: 'AUT', ireland: 'IRL', portugal: 'PRT', greece: 'GRC',
  new_zealand: 'NZL', israel: 'ISR', poland: 'POL', czech_republic: 'CZE',
  hungary: 'HUN', colombia: 'COL', chile: 'CHL', indonesia: 'IDN',
}

const CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_MAP).map(([k, v]) => [v, k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())]),
)

const FREQ_MAP: Record<string, string> = { annual: 'A', quarter: 'Q', monthly: 'M' }

/** Parse simple CSV text into rows */
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',')
  return lines.slice(1).map(line => {
    const values = line.split(',')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h.trim()] = values[i]?.trim() ?? '' })
    return row
  })
}

export class OECDConsumerPriceIndexFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): OECDCPIQueryParams {
    return OECDCPIQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: OECDCPIQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const countryCode = resolveCountryCodes(query.country)
    const freq = FREQ_MAP[query.frequency] ?? 'M'
    const methodology = query.harmonized ? 'HICP' : 'N'
    const units = query.transform === 'yoy' ? 'PA' : query.transform === 'period' ? 'PC' : 'IX'
    const expenditure = '_T'

    // Use CSV format (matching Python implementation)
    // Dimension order: REF_AREA.FREQ.METHODOLOGY.MEASURE.UNIT_MEASURE.EXPENDITURE.UNIT_MULT.
    const url =
      `https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0` +
      `/${countryCode}.${freq}.${methodology}.CPI.${units}.${expenditure}.N.` +
      `?dimensionAtObservation=TIME_PERIOD&detail=dataonly&format=csvfile`

    try {
      const resp = await nativeFetch(url, {
        headers: { Accept: 'application/vnd.sdmx.data+csv; charset=utf-8' },
        timeoutMs: 30000,
      })
      if (resp.status !== 200) throw new EmptyDataError(`OECD CPI API returned ${resp.status}`)
      const rows = parseCSV(resp.text)
      if (!rows.length) throw new EmptyDataError()

      return rows
        .filter(r => r.OBS_VALUE && r.OBS_VALUE !== '')
        .map(r => {
          const period = r.TIME_PERIOD ?? ''
          return {
            date: period.length === 7 ? period + '-01' : period.length === 4 ? period + '-01-01' : period,
            country: CODE_TO_NAME[r.REF_AREA] ?? r.REF_AREA ?? query.country,
            value: parseFloat(r.OBS_VALUE),
          }
        })
    } catch (err) {
      if (err instanceof EmptyDataError) throw err
      throw new EmptyDataError(`Failed to fetch OECD CPI data: ${err}`)
    }
  }

  static override transformData(
    query: OECDCPIQueryParams,
    data: Record<string, unknown>[],
  ): OECDCPIData[] {
    if (data.length === 0) throw new EmptyDataError()
    let filtered = data
    if (query.start_date) filtered = filtered.filter(d => String(d.date) >= query.start_date!)
    if (query.end_date) filtered = filtered.filter(d => String(d.date) <= query.end_date!)
    return filtered
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => ConsumerPriceIndexDataSchema.parse(d))
  }
}
