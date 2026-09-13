/**
 * OECD Share Price Index Fetcher.
 * Uses OECD Main Economic Indicators (MEI) dataset.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { SharePriceIndexDataSchema } from '../../../standard-models/share-price-index.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchOecdCsv, resolveCountryCodes, periodToDate, CODE_TO_NAME, FREQ_MAP, filterAndSort } from '../utils/oecd-helpers.js'

export const OECDSharePriceIndexQueryParamsSchema = z.object({
  country: z.string().default('united_states'),
  frequency: z.enum(['annual', 'quarter', 'monthly']).default('monthly'),
  start_date: z.string().nullable().default(null),
  end_date: z.string().nullable().default(null),
}).passthrough()

export type OECDSharePriceIndexQueryParams = z.infer<typeof OECDSharePriceIndexQueryParamsSchema>

export class OECDSharePriceIndexFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): OECDSharePriceIndexQueryParams {
    return OECDSharePriceIndexQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: OECDSharePriceIndexQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const cc = resolveCountryCodes(query.country)
    const freq = FREQ_MAP[query.frequency] ?? 'M'
    const rows = await fetchOecdCsv(
      // DSD_KEI was retired in the OECD SDMX reshuffle; share prices live
      // in the Financial market dataflow now (9-dim key, wildcards after
      // MEASURE select IX/_Z/.../N automatically — only one series exists).
      'OECD.SDD.STES,DSD_STES@DF_FINMARK',
      `${cc}.${freq}.SHARE......`,
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
    query: OECDSharePriceIndexQueryParams,
    data: Record<string, unknown>[],
  ) {
    if (data.length === 0) throw new EmptyDataError()
    return filterAndSort(data, query.start_date, query.end_date)
      .map(d => SharePriceIndexDataSchema.parse(d))
  }
}
