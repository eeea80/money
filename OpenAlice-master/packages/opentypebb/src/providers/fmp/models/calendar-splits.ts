/**
 * FMP Calendar Splits Model.
 * Maps to: openbb_fmp/models/calendar_splits.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CalendarSplitsQueryParamsSchema, CalendarSplitsDataSchema } from '../../../standard-models/calendar-splits.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPCalendarSplitsQueryParamsSchema = CalendarSplitsQueryParamsSchema.extend({})
export type FMPCalendarSplitsQueryParams = z.infer<typeof FMPCalendarSplitsQueryParamsSchema>

// --- Data ---

export const FMPCalendarSplitsDataSchema = CalendarSplitsDataSchema.extend({}).passthrough()
export type FMPCalendarSplitsData = z.infer<typeof FMPCalendarSplitsDataSchema>

// --- Fetcher ---

export class FMPCalendarSplitsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPCalendarSplitsQueryParams {
    return FMPCalendarSplitsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPCalendarSplitsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const now = new Date()
    const startDate = query.start_date ?? new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10)
    const endDate = query.end_date ?? new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10)

    const url = 'https://financialmodelingprep.com/stable/splits-calendar'
      + `?from=${startDate}&to=${endDate}&apikey=${apiKey}`
    return getDataMany(url)
  }

  static override transformData(
    query: FMPCalendarSplitsQueryParams,
    data: Record<string, unknown>[],
  ): FMPCalendarSplitsData[] {
    return data.map(d => FMPCalendarSplitsDataSchema.parse(d))
  }
}
