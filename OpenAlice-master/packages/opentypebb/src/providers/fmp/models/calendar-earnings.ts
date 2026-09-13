/**
 * FMP Earnings Calendar Model.
 * Maps to: openbb_fmp/models/calendar_earnings.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CalendarEarningsQueryParamsSchema, CalendarEarningsDataSchema } from '../../../standard-models/calendar-earnings.js'
import { applyAliases, amakeRequest } from '../../../core/provider/utils/helpers.js'
import { responseCallback } from '../utils/helpers.js'

// --- Query Params ---

export const FMPCalendarEarningsQueryParamsSchema = CalendarEarningsQueryParamsSchema

export type FMPCalendarEarningsQueryParams = z.infer<typeof FMPCalendarEarningsQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  report_date: 'date',
  eps_consensus: 'epsEstimated',
  eps_actual: 'epsActual',
  revenue_actual: 'revenueActual',
  revenue_consensus: 'revenueEstimated',
  last_updated: 'lastUpdated',
}

export const FMPCalendarEarningsDataSchema = CalendarEarningsDataSchema.extend({
  eps_actual: z.number().nullable().default(null).describe('The actual earnings per share announced.'),
  revenue_consensus: z.number().nullable().default(null).describe('The revenue forecast consensus.'),
  revenue_actual: z.number().nullable().default(null).describe('The actual reported revenue.'),
  last_updated: z.string().nullable().default(null).describe('The date the data was updated last.'),
}).passthrough()

export type FMPCalendarEarningsData = z.infer<typeof FMPCalendarEarningsDataSchema>

// --- Fetcher ---

export class FMPCalendarEarningsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPCalendarEarningsQueryParams {
    const now = new Date()
    if (params.start_date == null) {
      params.start_date = now.toISOString().split('T')[0]
    }
    if (params.end_date == null) {
      const threeDaysLater = new Date(now)
      threeDaysLater.setDate(threeDaysLater.getDate() + 3)
      params.end_date = threeDaysLater.toISOString().split('T')[0]
    }
    return FMPCalendarEarningsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPCalendarEarningsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const baseUrl = 'https://financialmodelingprep.com/stable/earnings-calendar?'
    const startDate = query.start_date ?? new Date().toISOString().split('T')[0]
    const endDate = query.end_date ?? new Date().toISOString().split('T')[0]

    // Create 7-day chunks
    const urls: string[] = []
    let currentStart = new Date(startDate)
    const end = new Date(endDate)

    while (currentStart <= end) {
      const chunkEnd = new Date(currentStart)
      chunkEnd.setDate(chunkEnd.getDate() + 7)
      const actualEnd = chunkEnd > end ? end : chunkEnd

      const from = currentStart.toISOString().split('T')[0]
      const to = actualEnd.toISOString().split('T')[0]
      urls.push(`${baseUrl}from=${from}&to=${to}&apikey=${apiKey}`)

      currentStart = new Date(actualEnd)
      currentStart.setDate(currentStart.getDate() + 1)
    }

    const allData: Record<string, unknown>[] = []
    const results = await Promise.all(
      urls.map((url) => amakeRequest<Record<string, unknown>[]>(url, { responseCallback }).catch(() => [])),
    )

    for (const batch of results) {
      if (Array.isArray(batch)) allData.push(...batch)
    }

    return allData
  }

  static override transformData(
    query: FMPCalendarEarningsQueryParams,
    data: Record<string, unknown>[],
  ): FMPCalendarEarningsData[] {
    const sorted = [...data].sort((a, b) =>
      String(b.date ?? '').localeCompare(String(a.date ?? '')),
    )

    return sorted.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPCalendarEarningsDataSchema.parse(aliased)
    })
  }
}
