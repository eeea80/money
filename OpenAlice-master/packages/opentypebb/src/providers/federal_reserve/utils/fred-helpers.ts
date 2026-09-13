/**
 * FRED API shared helpers.
 *
 * Provides reusable functions for fetching data from the
 * Federal Reserve Economic Data (FRED) API.
 */

import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { resolveKeyedOrigin } from '../../../core/provider/utils/hub-proxy.js'

const FRED_BASE = 'https://api.stlouisfed.org/fred'
const GEOFRED_BASE = 'https://api.stlouisfed.org/geofred'

export interface FredObservation {
  date: string
  value: string
}

export interface FredSeriesInfo {
  id: string
  title: string
  frequency_short: string
  units_short: string
  seasonal_adjustment_short: string
  last_updated: string
  notes: string
}

/**
 * Build a FRED API URL with common parameters.
 *
 * Pass `base` to target a sibling API tree on api.stlouisfed.org —
 * GeoFRED is at /geofred/... (no /fred/ prefix), not under /fred/geofred/.
 */
function buildFredUrl(
  endpoint: string,
  params: Record<string, string | number | undefined>,
  apiKey: string,
  base: string = FRED_BASE,
): string {
  // `hub:<url>` sentinel → route via the TraderHub keyed proxy (it
  // injects its own key); path layout under the origin is identical.
  const { key, origin } = resolveKeyedOrigin(apiKey, 'https://api.stlouisfed.org', 'fred')
  const tree = base === GEOFRED_BASE ? 'geofred' : 'fred'
  const url = new URL(`${origin}/${tree}/${endpoint}`)
  url.searchParams.set('file_type', 'json')
  if (key) url.searchParams.set('api_key', key)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

/**
 * Fetch observations for a single FRED series.
 *
 * When the caller supplies `limit` without an explicit start date,
 * "limit N" means "the latest N observations" — fetch desc and reverse
 * to ascending so downstream date-based merges keep working. Asking
 * upstream desc + reversing is what aligns with the OpenBB Python
 * upstream and with user intuition; the prior asc default returned
 * 1946-era observations for any limited query without an anchor date.
 */
export async function fetchFredSeries(
  seriesId: string,
  apiKey: string,
  opts: {
    startDate?: string | null
    endDate?: string | null
    limit?: number
    sortOrder?: 'asc' | 'desc'
    frequency?: string
    units?: string
  } = {},
): Promise<FredObservation[]> {
  const sortOrder = opts.sortOrder ?? 'desc'
  const url = buildFredUrl('series/observations', {
    series_id: seriesId,
    observation_start: opts.startDate ?? undefined,
    observation_end: opts.endDate ?? undefined,
    limit: opts.limit,
    sort_order: sortOrder,
    frequency: opts.frequency,
    units: opts.units,
  }, apiKey)

  const data = await amakeRequest<{ observations?: FredObservation[] }>(url)
  const observations = (data.observations ?? []).filter(o => o.value !== '.')
  // Caller-facing contract is ascending. If the upstream call ran desc,
  // reverse before returning so multiSeriesToRecords' localeCompare and
  // any date-ordered consumer keeps the same shape as before.
  return sortOrder === 'desc' ? observations.reverse() : observations
}

/**
 * Fetch multiple FRED series and merge by date.
 * Returns records keyed by date, with each series as a field.
 */
export async function fetchFredMultiSeries(
  seriesIds: string[],
  apiKey: string,
  opts: {
    startDate?: string | null
    endDate?: string | null
    limit?: number
    frequency?: string
  } = {},
): Promise<Record<string, Record<string, number | null>>> {
  const dataMap: Record<string, Record<string, number | null>> = {}
  let firstError: unknown = null

  for (const seriesId of seriesIds) {
    try {
      const observations = await fetchFredSeries(seriesId, apiKey, {
        startDate: opts.startDate,
        endDate: opts.endDate,
        limit: opts.limit,
        frequency: opts.frequency,
      })
      for (const obs of observations) {
        const val = parseFloat(obs.value)
        if (!dataMap[obs.date]) dataMap[obs.date] = {}
        dataMap[obs.date][seriesId] = isNaN(val) ? null : val
      }
    } catch (err) {
      // One bad series id must not kill the batch — but remember the
      // failure so a TOTAL wipeout (bad/missing key rejects everything)
      // surfaces the real cause instead of "no data found".
      firstError ??= err
    }
  }

  if (Object.keys(dataMap).length === 0 && firstError) throw firstError

  return dataMap
}

/**
 * Search FRED series by keyword.
 */
export async function fredSearchApi(
  query: string,
  apiKey: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<FredSeriesInfo[]> {
  const url = buildFredUrl('series/search', {
    search_text: query,
    limit: opts.limit ?? 100,
    offset: opts.offset ?? 0,
  }, apiKey)

  const data = await amakeRequest<{ seriess?: FredSeriesInfo[] }>(url)
  return data.seriess ?? []
}

/**
 * Fetch a FRED release table.
 */
export async function fredReleaseTableApi(
  releaseId: string,
  apiKey: string,
  opts: { elementId?: number; date?: string } = {},
): Promise<Record<string, unknown>[]> {
  const url = buildFredUrl('release/tables', {
    release_id: releaseId,
    element_id: opts.elementId,
    include_observation_values: 'true',
    observation_date: opts.date,
  }, apiKey)

  const data = await amakeRequest<{ elements?: Record<string, unknown> }>(url)
  if (!data.elements) return []

  return Object.values(data.elements).map(el => el as Record<string, unknown>)
}

/**
 * Fetch FRED regional/GeoFRED data.
 *
 * GeoFRED lives at api.stlouisfed.org/geofred/... — a sibling tree of
 * /fred/, not a child. The endpoint takes `series_id` (e.g. WIPCPI for
 * per-capita income), and returns data nested under `meta.data`, keyed
 * by observation date.
 */
export async function fredRegionalApi(
  seriesId: string,
  apiKey: string,
  opts: {
    regionType?: string
    date?: string
    startDate?: string
    seasonalAdjustment?: string
    units?: string
    frequency?: string
    transformationCode?: string
  } = {},
): Promise<Record<string, unknown>[]> {
  const url = buildFredUrl('series/data', {
    series_id: seriesId,
    region_type: opts.regionType ?? 'state',
    date: opts.date,
    start_date: opts.startDate,
    season: opts.seasonalAdjustment ?? 'SA',
    units: opts.units,
    frequency: opts.frequency,
    transformation: opts.transformationCode,
  }, apiKey, GEOFRED_BASE)

  const data = await amakeRequest<{ meta?: { data?: Record<string, unknown> } }>(url)
  const dataMap = data.meta?.data
  if (!dataMap) return []

  // GeoFRED returns { meta: { data: { "2024-01-01": [{ region, code, value, series_id }, ...] } } }
  const results: Record<string, unknown>[] = []
  for (const [date, regions] of Object.entries(dataMap)) {
    if (Array.isArray(regions)) {
      for (const region of regions) {
        results.push({ date, ...(region as Record<string, unknown>) })
      }
    }
  }
  return results
}

/**
 * Convert a FRED multi-series result to an array of flat records.
 */
export function multiSeriesToRecords(
  dataMap: Record<string, Record<string, number | null>>,
  fieldMap?: Record<string, string>,
): Record<string, unknown>[] {
  return Object.entries(dataMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => {
      const record: Record<string, unknown> = { date }
      if (fieldMap) {
        for (const [seriesId, fieldName] of Object.entries(fieldMap)) {
          record[fieldName] = values[seriesId] ?? null
        }
      } else {
        Object.assign(record, values)
      }
      return record
    })
}

/**
 * Get credentials helper — extracts the FRED API key.
 *
 * The SDK path delivers the key as `federal_reserve_api_key` (the
 * provider-prefixed form, see Provider constructor). Older callers
 * and direct helper invocations may still pass `fred_api_key` or
 * `api_key`; keep them as fallback so this helper stays compatible
 * with both call sites.
 */
export function getFredApiKey(credentials: Record<string, string> | null): string {
  return credentials?.federal_reserve_api_key
      ?? credentials?.fred_api_key
      ?? credentials?.api_key
      ?? ''
}
