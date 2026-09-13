/**
 * Federal Reserve Primary Dealer Positioning Fetcher.
 *
 * Primary dealer statistics do NOT live on FRED (the original port pointed
 * at made-up FRED ids and 400'd forever) — they come from the NY Fed
 * markets API, keyless:
 *   https://markets.newyorkfed.org/api/pd/get/{keyid}.json
 *
 * We fetch the major net-position totals (weekly, $ millions):
 *   PDPOSGST-TOT  US Treasuries total
 *   PDPOSMBS-TOT  Mortgage-backed securities
 *   PDPOSCS-TOT   Corporate securities
 *   PDPOSABS-TOT  Asset-backed securities
 *   PDPOSFGS-TOT  Federal agency (non-MBS)
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { PrimaryDealerPositioningQueryParamsSchema, PrimaryDealerPositioningDataSchema } from '../../../standard-models/primary-dealer-positioning.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'

export const FedPrimaryDealerPositioningQueryParamsSchema = PrimaryDealerPositioningQueryParamsSchema
export type FedPrimaryDealerPositioningQueryParams = z.infer<typeof FedPrimaryDealerPositioningQueryParamsSchema>

const NYFED_PD_BASE = 'https://markets.newyorkfed.org/api/pd/get'

const SERIES: Record<string, string> = {
  'PDPOSGST-TOT': 'treasury_total',
  'PDPOSMBS-TOT': 'mbs_total',
  'PDPOSCS-TOT': 'corporate_total',
  'PDPOSABS-TOT': 'abs_total',
  'PDPOSFGS-TOT': 'agency_total',
}

interface NyFedPdResponse {
  pd?: { timeseries?: Array<{ asofdate: string; keyid: string; value: string }> }
}

export class FedPrimaryDealerPositioningFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedPrimaryDealerPositioningQueryParams {
    return FedPrimaryDealerPositioningQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedPrimaryDealerPositioningQueryParams,
  ): Promise<Record<string, unknown>[]> {
    const byDate: Record<string, Record<string, number>> = {}
    let firstError: unknown = null

    await Promise.all(
      Object.entries(SERIES).map(async ([keyid, field]) => {
        try {
          const data = await amakeRequest<NyFedPdResponse>(`${NYFED_PD_BASE}/${keyid}.json`)
          for (const row of data.pd?.timeseries ?? []) {
            const v = parseFloat(row.value)
            if (Number.isNaN(v)) continue
            if (query.start_date && row.asofdate < query.start_date) continue
            if (query.end_date && row.asofdate > query.end_date) continue
            ;(byDate[row.asofdate] ??= {})[field] = v
          }
        } catch (err) {
          // One series failing must not kill the batch, but a TOTAL wipeout
          // should surface the real cause (same rule as fetchFredMultiSeries).
          firstError ??= err
        }
      }),
    )

    if (Object.keys(byDate).length === 0) {
      if (firstError) throw firstError instanceof Error ? firstError : new Error(String(firstError))
      throw new EmptyDataError('No primary dealer positioning data found.')
    }

    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, fields]) => {
        const total = Object.values(fields).reduce((s, v) => s + v, 0)
        return { date, total_net_position: total, ...fields }
      })
  }

  static override transformData(
    _query: FedPrimaryDealerPositioningQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => PrimaryDealerPositioningDataSchema.parse(d))
  }
}
