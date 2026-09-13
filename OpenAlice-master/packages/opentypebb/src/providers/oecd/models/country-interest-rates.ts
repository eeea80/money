/**
 * OECD Country Interest Rates Model.
 * Maps to: openbb_oecd/models/country_interest_rates.py
 *
 * Uses CSV format from OECD SDMX REST API (same as Python implementation).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CountryInterestRatesDataSchema } from '../../../standard-models/country-interest-rates.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { nativeFetch } from '../../../core/provider/utils/helpers.js'
import { resolveCountryCodes } from '../utils/oecd-helpers.js'

export const OECDInterestRatesQueryParamsSchema = z.object({
  country: z.string().default('united_states').describe('The country to get data for.'),
  duration: z.enum(['short', 'long']).default('short').describe('Duration of the interest rate (short or long).'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type OECDInterestRatesQueryParams = z.infer<typeof OECDInterestRatesQueryParamsSchema>
export type OECDInterestRatesData = z.infer<typeof CountryInterestRatesDataSchema>

const COUNTRY_MAP: Record<string, string> = {
  united_states: 'USA', united_kingdom: 'GBR', japan: 'JPN', germany: 'DEU',
  france: 'FRA', italy: 'ITA', canada: 'CAN', australia: 'AUS',
  south_korea: 'KOR', mexico: 'MEX', brazil: 'BRA', china: 'CHN',
  spain: 'ESP', netherlands: 'NLD', switzerland: 'CHE', sweden: 'SWE',
  norway: 'NOR', denmark: 'DNK', new_zealand: 'NZL', poland: 'POL',
}

const CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_MAP).map(([k, v]) => [v, k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())]),
)

const DURATION_MAP: Record<string, string> = { short: 'IR3TIB', long: 'IRLT' }

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

export class OECDCountryInterestRatesFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): OECDInterestRatesQueryParams {
    if (!params.start_date) params.start_date = '1950-01-01'
    if (!params.end_date) {
      const y = new Date().getFullYear()
      params.end_date = `${y}-12-31`
    }
    return OECDInterestRatesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: OECDInterestRatesQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const countryCode = resolveCountryCodes(query.country)
    const duration = DURATION_MAP[query.duration] ?? 'IR3TIB'
    const startPeriod = query.start_date ? query.start_date.slice(0, 7) : ''
    const endPeriod = query.end_date ? query.end_date.slice(0, 7) : ''

    const url =
      `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_KEI@DF_KEI,4.0` +
      `/${countryCode}.M.${duration}....` +
      `?startPeriod=${startPeriod}&endPeriod=${endPeriod}` +
      `&dimensionAtObservation=TIME_PERIOD&detail=dataonly`

    try {
      const resp = await nativeFetch(url, {
        headers: { Accept: 'application/vnd.sdmx.data+csv; charset=utf-8' },
        timeoutMs: 20000,
      })
      if (resp.status !== 200) throw new EmptyDataError(`OECD API returned ${resp.status}`)
      const text = resp.text
      const rows = parseCSV(text)
      if (!rows.length) throw new EmptyDataError()

      return rows
        .filter(r => r.OBS_VALUE && r.OBS_VALUE !== '')
        .map(r => ({
          date: r.TIME_PERIOD ? r.TIME_PERIOD + '-01' : '',
          value: parseFloat(r.OBS_VALUE) / 100,
          country: CODE_TO_NAME[r.REF_AREA] ?? r.REF_AREA ?? query.country,
        }))
    } catch (err) {
      if (err instanceof EmptyDataError) throw err
      throw new EmptyDataError(`Failed to fetch OECD interest rates: ${err}`)
    }
  }

  static override transformData(
    _query: OECDInterestRatesQueryParams,
    data: Record<string, unknown>[],
  ): OECDInterestRatesData[] {
    if (data.length === 0) throw new EmptyDataError()
    return data
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => CountryInterestRatesDataSchema.parse(d))
  }
}
