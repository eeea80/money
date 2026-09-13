/**
 * Federal Reserve FOMC Documents Fetcher.
 *
 * Scrapes the FOMC calendar page for REAL document links — policy
 * statements, meeting minutes and projection materials. (The original
 * port returned fed-funds target observations relabelled as "documents",
 * and called FRED without an api key, so it always came back empty.)
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { FomcDocumentsQueryParamsSchema, FomcDocumentsDataSchema } from '../../../standard-models/fomc-documents.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { nativeFetch } from '../../../core/provider/utils/helpers.js'

export const FedFomcDocumentsQueryParamsSchema = FomcDocumentsQueryParamsSchema
export type FedFomcDocumentsQueryParams = z.infer<typeof FedFomcDocumentsQueryParamsSchema>

const FED_BASE = 'https://www.federalreserve.gov'
const FOMC_CALENDAR_URL = `${FED_BASE}/monetarypolicy/fomccalendars.htm`

function isoFromYmd(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

export class FedFomcDocumentsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedFomcDocumentsQueryParams {
    return FedFomcDocumentsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedFomcDocumentsQueryParams,
  ): Promise<Record<string, unknown>[]> {
    const resp = await nativeFetch(FOMC_CALENDAR_URL, { timeoutMs: 30_000 })
    if (resp.status !== 200) throw new EmptyDataError(`FOMC calendar page returned HTTP ${resp.status}.`)
    const html = resp.text

    // The calendar page links every published document with the meeting
    // date embedded in the filename — regex beats DOM-walking here.
    const PATTERNS: Array<{ re: RegExp; type: string; title: (d: string) => string }> = [
      {
        re: /\/newsevents\/pressreleases\/monetary(\d{8})a1?\.htm/g,
        type: 'statement',
        title: (d) => `FOMC Statement — ${d}`,
      },
      {
        re: /\/monetarypolicy\/fomcminutes(\d{8})\.htm/g,
        type: 'minutes',
        title: (d) => `FOMC Minutes — ${d}`,
      },
      {
        re: /\/monetarypolicy\/files\/fomcprojtabl(\d{8})\.pdf/g,
        type: 'projections',
        title: (d) => `FOMC Projection Materials — ${d}`,
      },
    ]

    const seen = new Set<string>()
    const rows: Record<string, unknown>[] = []
    for (const { re, type, title } of PATTERNS) {
      for (const m of html.matchAll(re)) {
        const date = isoFromYmd(m[1])
        const key = `${type}|${date}`
        if (seen.has(key)) continue
        seen.add(key)
        rows.push({ date, title: title(date), type, url: `${FED_BASE}${m[0]}` })
      }
    }

    if (rows.length === 0) throw new EmptyDataError('No FOMC documents found on the calendar page.')
    return rows
  }

  static override transformData(
    query: FedFomcDocumentsQueryParams,
    data: Record<string, unknown>[],
  ) {
    let filtered = data
    if (query.start_date) filtered = filtered.filter(d => String(d.date) >= query.start_date!)
    if (query.end_date) filtered = filtered.filter(d => String(d.date) <= query.end_date!)
    return filtered
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(d => FomcDocumentsDataSchema.parse(d))
  }
}
