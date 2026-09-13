/**
 * OECD GDP Forecast Fetcher.
 * Uses OECD Economic Outlook dataset.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { GdpForecastDataSchema } from '../../../standard-models/gdp-forecast.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchOecdCsv, resolveCountryCode, periodToDate, CODE_TO_NAME, FREQ_MAP, filterAndSort } from '../utils/oecd-helpers.js'

export const OECDGdpForecastQueryParamsSchema = z.object({
  country: z.string().default('united_states'),
  start_date: z.string().nullable().default(null),
  end_date: z.string().nullable().default(null),
  frequency: z.enum(['annual', 'quarter']).default('annual'),
}).passthrough()

export type OECDGdpForecastQueryParams = z.infer<typeof OECDGdpForecastQueryParamsSchema>

export class OECDGdpForecastFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): OECDGdpForecastQueryParams {
    return OECDGdpForecastQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: OECDGdpForecastQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const cc = resolveCountryCode(query.country)
    const freq = FREQ_MAP[query.frequency] ?? 'A'
    const rows = await fetchOecdCsv(
      'OECD.SDD.NAD,DSD_NAMAIN1@DF_TABLE1_EXPENDITURE_HCPC,1.0',
      `${cc}.${freq}.S1.S1.B1GQ._Z._Z._Z.V.GY.`,
    )

    return rows
      .filter(r => r.OBS_VALUE && r.OBS_VALUE !== '')
      .map(r => ({
        date: periodToDate(r.TIME_PERIOD ?? ''),
        country: CODE_TO_NAME[r.REF_AREA] ?? r.REF_AREA ?? query.country,
        value: parseFloat(r.OBS_VALUE),
      }))
  }

  static override transformData(
    query: OECDGdpForecastQueryParams,
    data: Record<string, unknown>[],
  ) {
    if (data.length === 0) throw new EmptyDataError()
    return filterAndSort(data, query.start_date, query.end_date)
      .map(d => GdpForecastDataSchema.parse(d))
  }
}
