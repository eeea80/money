/**
 * Multpl S&P 500 Multiples Model.
 * Maps to: openbb_multpl/models/sp500_multiples.py
 *
 * Scrapes data tables from multpl.com.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { SP500MultiplesDataSchema } from '../../../standard-models/sp500-multiples.js'
import { EmptyDataError, OpenBBError } from '../../../core/provider/utils/errors.js'
import { nativeFetch } from '../../../core/provider/utils/helpers.js'

const BASE_URL = 'https://www.multpl.com/'

const URL_DICT: Record<string, string> = {
  shiller_pe_month: 'shiller-pe/table/by-month',
  shiller_pe_year: 'shiller-pe/table/by-year',
  pe_year: 's-p-500-pe-ratio/table/by-year',
  pe_month: 's-p-500-pe-ratio/table/by-month',
  dividend_year: 's-p-500-dividend/table/by-year',
  dividend_month: 's-p-500-dividend/table/by-month',
  dividend_growth_quarter: 's-p-500-dividend-growth/table/by-quarter',
  dividend_growth_year: 's-p-500-dividend-growth/table/by-year',
  dividend_yield_year: 's-p-500-dividend-yield/table/by-year',
  dividend_yield_month: 's-p-500-dividend-yield/table/by-month',
  earnings_year: 's-p-500-earnings/table/by-year',
  earnings_month: 's-p-500-earnings/table/by-month',
  earnings_growth_year: 's-p-500-earnings-growth/table/by-year',
  earnings_growth_quarter: 's-p-500-earnings-growth/table/by-quarter',
  real_earnings_growth_year: 's-p-500-real-earnings-growth/table/by-year',
  real_earnings_growth_quarter: 's-p-500-real-earnings-growth/table/by-quarter',
  earnings_yield_year: 's-p-500-earnings-yield/table/by-year',
  earnings_yield_month: 's-p-500-earnings-yield/table/by-month',
  real_price_year: 's-p-500-historical-prices/table/by-year',
  real_price_month: 's-p-500-historical-prices/table/by-month',
  inflation_adjusted_price_year: 'inflation-adjusted-s-p-500/table/by-year',
  inflation_adjusted_price_month: 'inflation-adjusted-s-p-500/table/by-month',
  sales_year: 's-p-500-sales/table/by-year',
  sales_quarter: 's-p-500-sales/table/by-quarter',
  sales_growth_year: 's-p-500-sales-growth/table/by-year',
  sales_growth_quarter: 's-p-500-sales-growth/table/by-quarter',
  real_sales_year: 's-p-500-real-sales/table/by-year',
  real_sales_quarter: 's-p-500-real-sales/table/by-quarter',
  real_sales_growth_year: 's-p-500-real-sales-growth/table/by-year',
  real_sales_growth_quarter: 's-p-500-real-sales-growth/table/by-quarter',
  price_to_sales_year: 's-p-500-price-to-sales/table/by-year',
  price_to_sales_quarter: 's-p-500-price-to-sales/table/by-quarter',
  price_to_book_value_year: 's-p-500-price-to-book/table/by-year',
  price_to_book_value_quarter: 's-p-500-price-to-book/table/by-quarter',
  book_value_year: 's-p-500-book-value/table/by-year',
  book_value_quarter: 's-p-500-book-value/table/by-quarter',
}

export const MultplSP500MultiplesQueryParamsSchema = z.object({
  series_name: z.string().default('pe_month').describe('The name of the series.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
}).passthrough()

export type MultplSP500MultiplesQueryParams = z.infer<typeof MultplSP500MultiplesQueryParamsSchema>

export type MultplSP500MultiplesData = z.infer<typeof SP500MultiplesDataSchema>

/**
 * Parse an HTML table from multpl.com.
 * The tables have format: Date | Value
 */
function parseHtmlTable(html: string): Array<{ date: string; value: string }> {
  const rows: Array<{ date: string; value: string }> = []
  // Match table rows with two cells
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gs
  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(html)) !== null) {
    const dateStr = match[1].replace(/<[^>]+>/g, '').trim()
    const valueStr = match[2].replace(/<[^>]+>/g, '').trim()
    if (dateStr && valueStr && !dateStr.toLowerCase().includes('date')) {
      rows.push({ date: dateStr, value: valueStr })
    }
  }
  return rows
}

/**
 * Parse a date string from multpl.com (e.g., "Jan 31, 2024").
 */
function parseDate(dateStr: string): string | null {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  } catch {
    return null
  }
}

/**
 * Parse a value string from multpl.com.
 */
function parseValue(valueStr: string, isPercent: boolean): number | null {
  // Cells embed HTML entities (e.g. "\n&#x2002;\n41.54\n") — strip them
  // before parseFloat, which bails to NaN on a leading entity.
  const cleaned = valueStr
    .replace(/&#x?[0-9a-f]+;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/†/g, '').replace(/%/g, '').replace(/\$/g, '').replace(/,/g, '')
    .trim()
  const num = parseFloat(cleaned)
  if (isNaN(num)) return null
  return isPercent ? num / 100 : num
}

export class MultplSP500MultiplesFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): MultplSP500MultiplesQueryParams {
    const query = MultplSP500MultiplesQueryParamsSchema.parse(params)
    // Validate series names
    const series = query.series_name.split(',')
    for (const s of series) {
      if (!URL_DICT[s]) {
        throw new OpenBBError(`Invalid series_name: ${s}. Valid: ${Object.keys(URL_DICT).sort().join(', ')}`)
      }
    }
    return query
  }

  static override async extractData(
    query: MultplSP500MultiplesQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const series = query.series_name.split(',')
    const results: Record<string, unknown>[] = []

    const tasks = series.map(async (seriesName) => {
      const path = URL_DICT[seriesName]
      const url = `${BASE_URL}${path}`

      try {
        const resp = await nativeFetch(url, { timeoutMs: 30000 })
        if (resp.status !== 200) {
          console.warn(`Failed to fetch ${seriesName}: ${resp.status}`)
          return
        }

        const html = resp.text
        const rows = parseHtmlTable(html)
        const isPercent = seriesName.includes('growth') || seriesName.includes('yield')

        for (const row of rows) {
          const date = parseDate(row.date)
          if (!date) continue

          // Filter by date range
          if (query.start_date && date < query.start_date) continue
          if (query.end_date && date > query.end_date) continue

          const value = parseValue(row.value, isPercent)
          if (value === null) continue

          results.push({
            date,
            name: seriesName,
            value,
          })
        }
      } catch (err) {
        console.warn(`Failed to get data for ${seriesName}: ${err}`)
      }
    })

    await Promise.all(tasks)

    if (results.length === 0) throw new EmptyDataError('No data found.')
    return results
  }

  static override transformData(
    _query: MultplSP500MultiplesQueryParams,
    data: Record<string, unknown>[],
  ): MultplSP500MultiplesData[] {
    const sorted = data.sort((a, b) => {
      const dateCompare = String(a.date).localeCompare(String(b.date))
      if (dateCompare !== 0) return dateCompare
      return String(a.name).localeCompare(String(b.name))
    })
    return sorted.map(d => SP500MultiplesDataSchema.parse(d))
  }
}
