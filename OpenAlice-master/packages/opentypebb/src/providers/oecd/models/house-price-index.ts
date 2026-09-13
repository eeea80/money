/**
 * OECD House Price Index Fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { HousePriceIndexDataSchema } from '../../../standard-models/house-price-index.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchOecdCsv, resolveCountryCodes, periodToDate, CODE_TO_NAME, FREQ_MAP, filterAndSort } from '../utils/oecd-helpers.js'

export const OECDHousePriceIndexQueryParamsSchema = z.object({
  country: z.string().default('united_states'),
  frequency: z.enum(['annual', 'quarter', 'monthly']).default('quarter'),
  start_date: z.string().nullable().default(null),
  end_date: z.string().nullable().default(null),
}).passthrough()

export type OECDHousePriceIndexQueryParams = z.infer<typeof OECDHousePriceIndexQueryParamsSchema>

export class OECDHousePriceIndexFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): OECDHousePriceIndexQueryParams {
    return OECDHousePriceIndexQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: OECDHousePriceIndexQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const cc = resolveCountryCodes(query.country)
    const freq = FREQ_MAP[query.frequency] ?? 'Q'
    const rows = await fetchOecdCsv(
      // Agency moved in the 2025/26 SDMX reshuffle (was OECD.SDD.TPS, versioned).
      'OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES',
      // New DSD is 4-dimensional: REF_AREA.FREQ.MEASURE.UNIT_MEASURE
      `${cc}.${freq}.RHP.IX`,
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
    query: OECDHousePriceIndexQueryParams,
    data: Record<string, unknown>[],
  ) {
    if (data.length === 0) throw new EmptyDataError()
    return filterAndSort(data, query.start_date, query.end_date)
      .map(d => HousePriceIndexDataSchema.parse(d))
  }
}
