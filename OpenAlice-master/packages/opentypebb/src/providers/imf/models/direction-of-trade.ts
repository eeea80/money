/**
 * IMF Direction of Trade Model.
 * Maps to: openbb_imf/models/direction_of_trade.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { DirectionOfTradeDataSchema } from '../../../standard-models/direction-of-trade.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { nativeFetch } from '../../../core/provider/utils/helpers.js'

export const IMFDOTQueryParamsSchema = z.object({
  country: z.string().nullable().default(null).describe('Country for the trade data.'),
  counterpart: z.string().nullable().default(null).describe('Counterpart country.'),
  direction: z.enum(['exports', 'imports', 'balance', 'all']).default('balance').describe('Trade direction.'),
  start_date: z.string().nullable().default(null).describe('Start date in YYYY-MM-DD.'),
  end_date: z.string().nullable().default(null).describe('End date in YYYY-MM-DD.'),
  frequency: z.enum(['month', 'quarter', 'annual']).default('month').describe('Data frequency.'),
}).passthrough()

export type IMFDOTQueryParams = z.infer<typeof IMFDOTQueryParamsSchema>
export type IMFDOTData = z.infer<typeof DirectionOfTradeDataSchema>

const COUNTRY_ISO2: Record<string, string> = {
  united_states: 'US', united_kingdom: 'GB', japan: 'JP', germany: 'DE',
  france: 'FR', china: 'CN', india: 'IN', brazil: 'BR',
}

const FREQ_MAP: Record<string, string> = { month: 'M', quarter: 'Q', annual: 'A' }
const DIRECTION_MAP: Record<string, string> = { exports: 'TXG_FOB_USD', imports: 'TMG_CIF_USD', balance: 'TBG_USD' }

export class IMFDirectionOfTradeFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): IMFDOTQueryParams {
    return IMFDOTQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: IMFDOTQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const country = query.country ? (COUNTRY_ISO2[query.country] ?? query.country.toUpperCase().slice(0, 2)) : ''
    const counterpart = query.counterpart ? (COUNTRY_ISO2[query.counterpart] ?? query.counterpart.toUpperCase().slice(0, 2)) : 'W00'
    const freq = FREQ_MAP[query.frequency] ?? 'M'
    const indicators = query.direction === 'all'
      ? 'TXG_FOB_USD+TMG_CIF_USD+TBG_USD'
      : DIRECTION_MAP[query.direction] ?? 'TBG_USD'

    const url = `https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/DOT/${freq}.${country}.${indicators}.${counterpart}`

    try {
      const resp = await nativeFetch(url, { timeoutMs: 30000 })
      if (resp.status !== 200) throw new EmptyDataError(`IMF API returned ${resp.status}`)
      const data = JSON.parse(resp.text) as Record<string, unknown>
      const dataset = data.CompactData as Record<string, unknown>
      const dataSet = dataset?.DataSet as Record<string, unknown>
      let series = dataSet?.Series as Record<string, unknown> | Record<string, unknown>[]

      if (!series) throw new EmptyDataError()
      if (!Array.isArray(series)) series = [series]

      const results: Record<string, unknown>[] = []
      for (const s of series) {
        const indicator = s['@INDICATOR'] as string
        let obs = (s.Obs ?? []) as Record<string, unknown> | Record<string, unknown>[]
        if (!Array.isArray(obs)) obs = [obs]

        for (const o of obs) {
          const period = o['@TIME_PERIOD'] as string
          const value = parseFloat(o['@OBS_VALUE'] as string)
          if (period && !isNaN(value)) {
            const date = period.length === 7 ? period + '-01' : period.length === 4 ? period + '-01-01' : period
            results.push({
              date,
              symbol: indicator,
              country: query.country ?? 'all',
              counterpart: query.counterpart ?? 'world',
              title: indicator,
              value,
              scale: 'millions_usd',
            })
          }
        }
      }

      return results
    } catch (err) {
      if (err instanceof EmptyDataError) throw err
      throw new EmptyDataError(`Failed to fetch IMF DOT data: ${err}`)
    }
  }

  static override transformData(
    query: IMFDOTQueryParams,
    data: Record<string, unknown>[],
  ): IMFDOTData[] {
    if (data.length === 0) throw new EmptyDataError()
    let filtered = data
    if (query.start_date) filtered = filtered.filter(d => String(d.date) >= query.start_date!)
    if (query.end_date) filtered = filtered.filter(d => String(d.date) <= query.end_date!)
    return filtered
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => DirectionOfTradeDataSchema.parse(d))
  }
}
