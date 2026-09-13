/**
 * FMP Helpers Module.
 * Maps to: openbb_fmp/utils/helpers.py
 */

import { OpenBBError, EmptyDataError, UnauthorizedError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'

/**
 * Response callback for FMP API requests.
 * Maps to: response_callback() in helpers.py
 */
export async function responseCallback(response: Response): Promise<Response> {
  if (response.status !== 200) {
    const msg = await response.text().catch(() => '')
    throw new UnauthorizedError(`Unauthorized FMP request -> ${response.status} -> ${msg}`)
  }

  const data = await response.json()

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const errorMessage = (data as Record<string, unknown>)['Error Message'] ??
      (data as Record<string, unknown>)['error']

    if (errorMessage != null) {
      const msg = String(errorMessage).toLowerCase()
      const isUnauthorized =
        msg.includes('upgrade') ||
        msg.includes('exclusive endpoint') ||
        msg.includes('special endpoint') ||
        msg.includes('premium query parameter') ||
        msg.includes('subscription') ||
        msg.includes('unauthorized') ||
        msg.includes('premium')

      if (isUnauthorized) {
        throw new UnauthorizedError(`Unauthorized FMP request -> ${errorMessage}`)
      }

      throw new OpenBBError(
        `FMP Error Message -> Status code: ${response.status} -> ${errorMessage}`,
      )
    }
  }

  // Return a new Response with the already-parsed body
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/**
 * Get data from FMP endpoint.
 * Maps to: get_data() in helpers.py
 */
export async function getData<T = unknown>(url: string): Promise<T> {
  return amakeRequest<T>(url, { responseCallback })
}

/**
 * Get data from FMP for several urls.
 * Maps to: get_data_urls() in helpers.py
 */
export async function getDataUrls<T = unknown>(urls: string[]): Promise<T[]> {
  const results = await Promise.all(
    urls.map((url) => amakeRequest<T>(url, { responseCallback })),
  )
  return results
}

/**
 * Get data from FMP endpoint and convert to list of dicts.
 * Maps to: get_data_many() in helpers.py
 */
export async function getDataMany(url: string, subDict?: string): Promise<Record<string, unknown>[]> {
  let data = await getData<unknown>(url)

  if (subDict && data && typeof data === 'object' && !Array.isArray(data)) {
    data = (data as Record<string, unknown>)[subDict] ?? []
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    throw new OpenBBError('Expected list of dicts, got dict')
  }

  const arr = data as Record<string, unknown>[]
  if (!arr || arr.length === 0) {
    throw new EmptyDataError()
  }

  return arr
}

/**
 * Get data from FMP endpoint and convert to a single dict.
 * Maps to: get_data_one() in helpers.py
 */
export async function getDataOne(url: string): Promise<Record<string, unknown>> {
  let data = await getData<unknown>(url)

  if (Array.isArray(data)) {
    if (data.length === 0) {
      throw new OpenBBError('Expected dict, got empty list')
    }
    data = data.length > 1
      ? Object.fromEntries(data.map((item, i) => [i, item]))
      : data[0]
  }

  return data as Record<string, unknown>
}

/**
 * Create a URL for the FMP API.
 * Maps to: create_url() in helpers.py
 */
export function createUrl(
  version: number,
  endpoint: string,
  apiKey: string | null,
  query?: Record<string, unknown>,
  exclude?: string[],
): string {
  const params: Record<string, unknown> = { ...(query ?? {}) }
  const excludeSet = new Set(exclude ?? [])

  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (!excludeSet.has(key) && value !== null && value !== undefined) {
      searchParams.set(key, String(value))
    }
  }

  const queryString = searchParams.toString()
  const baseUrl = `https://financialmodelingprep.com/api/v${version}/`
  return `${baseUrl}${endpoint}?${queryString}&apikey=${apiKey ?? ''}`
}

/**
 * Get the FMP interval string.
 * Maps to: get_interval() in helpers.py
 */
export function getInterval(value: string): string {
  const intervals: Record<string, string> = {
    m: 'min',
    h: 'hour',
    d: 'day',
  }
  const suffix = value.slice(-1)
  const num = value.slice(0, -1)
  return `${num}${intervals[suffix] ?? suffix}`
}

/**
 * Get the most recent quarter date.
 * Maps to: most_recent_quarter() in helpers.py
 */
export function mostRecentQuarter(base?: Date): Date {
  const now = new Date()
  let d = base ? new Date(Math.min(base.getTime(), now.getTime())) : new Date(now)

  const month = d.getMonth() + 1 // 1-indexed
  const day = d.getDate()

  // Check exact quarter end dates
  const exacts: [number, number][] = [[3, 31], [6, 30], [9, 30], [12, 31]]
  for (const [m, dd] of exacts) {
    if (month === m && day === dd) return d
  }

  if (month < 4) return new Date(d.getFullYear() - 1, 11, 31)
  if (month < 7) return new Date(d.getFullYear(), 2, 31)
  if (month < 10) return new Date(d.getFullYear(), 5, 30)
  return new Date(d.getFullYear(), 8, 30)
}

/**
 * Build query string from params, excluding specified keys.
 * Maps to: get_querystring() in helpers.py
 */
export function getQueryString(
  params: Record<string, unknown>,
  exclude: string[] = [],
): string {
  const excludeSet = new Set(exclude)
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (!excludeSet.has(key) && value !== null && value !== undefined) {
      searchParams.set(key, String(value))
    }
  }

  return searchParams.toString()
}

/**
 * Return the raw data from the FMP historical OHLC endpoint.
 * Maps to: get_historical_ohlc() in helpers.py
 */
export async function getHistoricalOhlc(
  query: {
    symbol: string
    interval: string
    start_date?: string | null
    end_date?: string | null
    adjustment?: string
    [key: string]: unknown
  },
  credentials: Record<string, string> | null,
): Promise<Record<string, unknown>[]> {
  const apiKey = credentials?.fmp_api_key ?? ''
  let baseUrl = 'https://financialmodelingprep.com/stable/'

  if (query.adjustment === 'unadjusted') {
    baseUrl += 'historical-price-eod/non-split-adjusted?'
  } else if (query.adjustment === 'splits_and_dividends') {
    baseUrl += 'historical-price-eod/dividend-adjusted?'
  } else if (query.interval === '1d') {
    baseUrl += 'historical-price-eod/full?'
  } else if (query.interval === '1m') {
    baseUrl += 'historical-chart/1min?'
  } else if (query.interval === '5m') {
    baseUrl += 'historical-chart/5min?'
  } else if (query.interval === '60m' || query.interval === '1h') {
    baseUrl += 'historical-chart/1hour?'
  }

  // FMP's historical endpoints want `from` / `to`, not the canonical
  // `start_date` / `end_date`. Rename before serializing — otherwise FMP
  // silently ignores the range and returns its default 5-year window.
  const queryParams: Record<string, unknown> = { ...query }
  if (queryParams.start_date != null) {
    queryParams.from = queryParams.start_date
    delete queryParams.start_date
  }
  if (queryParams.end_date != null) {
    queryParams.to = queryParams.end_date
    delete queryParams.end_date
  }
  const excludeKeys = ['symbol', 'adjustment', 'interval']
  const queryStr = getQueryString(queryParams, excludeKeys)
  const symbols = query.symbol.split(',')

  const results: Record<string, unknown>[] = []
  const messages: string[] = []

  const getOne = async (symbol: string) => {
    const url = `${baseUrl}symbol=${symbol}&${queryStr}&apikey=${apiKey}`

    try {
      const response = await amakeRequest<unknown>(url, { responseCallback })

      if (typeof response === 'object' && response !== null && !Array.isArray(response)) {
        const dict = response as Record<string, unknown>
        if (dict['Error Message']) {
          const message = `Error fetching data for ${symbol}: ${dict['Error Message']}`
          console.warn(message)
          messages.push(message)
          return
        }

        const historical = dict['historical'] as Record<string, unknown>[] | undefined
        if (historical && historical.length > 0) {
          for (const d of historical) {
            d.symbol = symbol
            results.push(d)
          }
          return
        }
      }

      if (Array.isArray(response) && response.length > 0) {
        for (const d of response as Record<string, unknown>[]) {
          d.symbol = symbol
          results.push(d)
        }
        return
      }

      const message = `No data found for ${symbol}.`
      console.warn(message)
      messages.push(message)
    } catch (error) {
      const message = `Error fetching data for ${symbol}: ${error}`
      console.warn(message)
      messages.push(message)
    }
  }

  await Promise.all(symbols.map(getOne))

  if (results.length === 0) {
    throw new EmptyDataError(
      messages.length > 0 ? messages.join(' ') : 'No data found',
    )
  }

  return results
}
