/**
 * OECD SDMX API shared helpers.
 * Extracted from the existing CPI/CLI/InterestRates fetchers to avoid repetition.
 */

import { nativeFetch } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'

export const COUNTRY_MAP: Record<string, string> = {
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

export const CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_MAP).map(([k, v]) => [v, k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())]),
)

export const FREQ_MAP: Record<string, string> = { annual: 'A', quarter: 'Q', monthly: 'M' }

/**
 * Parse simple CSV text into rows.
 */
export function parseCSV(text: string): Record<string, string>[] {
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

/**
 * Convert OECD period format to date string.
 * "2024" → "2024-01-01", "2024-01" → "2024-01-01", "2024-Q1" → "2024-01-01"
 */
export function periodToDate(period: string): string {
  if (period.includes('-Q')) {
    const [year, q] = period.split('-Q')
    const month = String((parseInt(q) - 1) * 3 + 1).padStart(2, '0')
    return `${year}-${month}-01`
  }
  if (period.length === 7) return period + '-01'
  if (period.length === 4) return period + '-01-01'
  return period
}

/**
 * Fetch data from OECD SDMX REST API in CSV format.
 */
export async function fetchOecdCsv(
  dataflow: string,
  dimensions: string,
): Promise<Record<string, string>[]> {
  const url =
    `https://sdmx.oecd.org/public/rest/data/${dataflow}` +
    `/${dimensions}` +
    `?dimensionAtObservation=TIME_PERIOD&detail=dataonly&format=csvfile`

  try {
    const resp = await nativeFetch(url, {
      headers: { Accept: 'application/vnd.sdmx.data+csv; charset=utf-8' },
      timeoutMs: 30000,
    })
    if (resp.status !== 200) throw new EmptyDataError(`OECD API returned ${resp.status}`)
    const rows = parseCSV(resp.text)
    if (!rows.length) throw new EmptyDataError()
    return rows
  } catch (err) {
    if (err instanceof EmptyDataError) throw err
    throw new EmptyDataError(`Failed to fetch OECD data: ${err}`)
  }
}

/**
 * Resolve country name to OECD 3-letter code.
 */
export function resolveCountryCode(country: string): string {
  return COUNTRY_MAP[country] ?? country.toUpperCase()
}

/**
 * Resolve one or many countries ("united_states,china") to an SDMX
 * REF_AREA filter ("USA+CHN"). Batching countries into ONE request is the
 * difference between a dashboard load costing N calls and 1 call against
 * OECD's small anonymous per-IP quota.
 */
export function resolveCountryCodes(country: string): string {
  return country
    .split(',')
    .map((c) => resolveCountryCode(c.trim()))
    .filter(Boolean)
    .join('+')
}

/**
 * Apply date filters and sort results.
 */
export function filterAndSort<T extends { date?: unknown }>(
  data: T[],
  startDate?: string | null,
  endDate?: string | null,
): T[] {
  let filtered = data
  if (startDate) filtered = filtered.filter(d => String(d.date) >= startDate)
  if (endDate) filtered = filtered.filter(d => String(d.date) <= endDate)
  return filtered.sort((a, b) => String(a.date).localeCompare(String(b.date)))
}
