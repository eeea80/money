/**
 * FMP Earnings Call Transcript Model.
 * Maps to: openbb_fmp/models/earnings_call_transcript.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EarningsCallTranscriptQueryParamsSchema, EarningsCallTranscriptDataSchema } from '../../../standard-models/earnings-call-transcript.js'
import { getDataMany, getDataOne } from '../utils/helpers.js'
import { OpenBBError } from '../../../core/provider/utils/errors.js'

const ALIAS_DICT: Record<string, string> = {
  quarter: 'period',
}

export const FMPEarningsCallTranscriptQueryParamsSchema = EarningsCallTranscriptQueryParamsSchema
export type FMPEarningsCallTranscriptQueryParams = z.infer<typeof FMPEarningsCallTranscriptQueryParamsSchema>

export const FMPEarningsCallTranscriptDataSchema = EarningsCallTranscriptDataSchema
export type FMPEarningsCallTranscriptData = z.infer<typeof FMPEarningsCallTranscriptDataSchema>

export class FMPEarningsCallTranscriptFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEarningsCallTranscriptQueryParams {
    return FMPEarningsCallTranscriptQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEarningsCallTranscriptQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const symbol = query.symbol.toUpperCase()

    // Get available transcript dates for the symbol
    let transcriptDates: Record<string, unknown>[]
    try {
      transcriptDates = await getDataMany(
        `https://financialmodelingprep.com/stable/earning-call-transcript-dates?symbol=${symbol}&apikey=${apiKey}`,
      )
    } catch {
      throw new OpenBBError(`No transcripts found for symbol ${symbol}.`)
    }

    if (!transcriptDates || transcriptDates.length === 0) {
      throw new OpenBBError(`No transcripts found for symbol ${symbol}.`)
    }

    // Sort by date descending
    transcriptDates.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))

    // Determine year and quarter
    let year = query.year ?? (transcriptDates[0].fiscalYear as number)
    let quarter = query.quarter ?? (transcriptDates[0].quarter as number)

    // Validate year exists
    const validYears = transcriptDates.map(t => t.fiscalYear)
    if (!validYears.includes(year)) {
      year = transcriptDates[0].fiscalYear as number
    }

    // Validate quarter exists for the year
    const yearTranscripts = transcriptDates.filter(t => t.fiscalYear === year)
    const validQuarters = yearTranscripts.map(t => t.quarter)
    if (!validQuarters.includes(quarter)) {
      quarter = yearTranscripts[0]?.quarter as number ?? 1
    }

    const url = `https://financialmodelingprep.com/stable/earning-call-transcript?symbol=${symbol}&year=${year}&quarter=${quarter}&apikey=${apiKey}`

    try {
      const result = await getDataOne(url)
      return [result]
    } catch {
      throw new OpenBBError(`No transcript found for ${symbol} in ${year} Q${quarter}`)
    }
  }

  static override transformData(
    _query: FMPEarningsCallTranscriptQueryParams,
    data: Record<string, unknown>[],
  ): FMPEarningsCallTranscriptData[] {
    if (!data || data.length === 0) {
      throw new OpenBBError('No data found.')
    }

    return data.map(d => {
      // Apply alias: period -> quarter
      if (d.period != null && d.quarter == null) {
        d.quarter = d.period
        delete d.period
      }
      return FMPEarningsCallTranscriptDataSchema.parse(d)
    })
  }
}
