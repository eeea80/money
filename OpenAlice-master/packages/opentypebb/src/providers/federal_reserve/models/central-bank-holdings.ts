/**
 * Federal Reserve Central Bank Holdings Model.
 * Maps to: openbb_federal_reserve/models/central_bank_holdings.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CentralBankHoldingsDataSchema } from '../../../standard-models/central-bank-holdings.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fetchFredMultiSeries, getFredApiKey } from '../utils/fred-helpers.js'

export const FedCentralBankHoldingsQueryParamsSchema = z.object({
  date: z.string().nullable().default(null).describe('Specific date for holdings data in YYYY-MM-DD.'),
}).passthrough()

export type FedCentralBankHoldingsQueryParams = z.infer<typeof FedCentralBankHoldingsQueryParamsSchema>

export const FedCentralBankHoldingsDataSchema = CentralBankHoldingsDataSchema.extend({
  treasury_holding_value: z.number().nullable().default(null).describe('Treasury securities held (millions USD).'),
  mbs_holding_value: z.number().nullable().default(null).describe('MBS held (millions USD).'),
  agency_holding_value: z.number().nullable().default(null).describe('Agency debt held (millions USD).'),
  total_assets: z.number().nullable().default(null).describe('Total assets (millions USD).'),
}).passthrough()

export type FedCentralBankHoldingsData = z.infer<typeof FedCentralBankHoldingsDataSchema>

export class FedCentralBankHoldingsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FedCentralBankHoldingsQueryParams {
    return FedCentralBankHoldingsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FedCentralBankHoldingsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    // H.4.1 weekly balance-sheet series on FRED:
    //   TREAST  = Treasury securities held outright
    //   WSHOMCB = MBS held outright
    //   WSHOFADSL = Federal agency debt securities
    //   WALCL   = Total assets
    // (The original port used a nonexistent 'MBST' id, mislabeled WSHOMCB
    // as total assets, and read the wrong credential key — three reasons
    // it always returned "no data".)
    const apiKey = getFredApiKey(credentials)
    if (!apiKey) {
      throw new Error('FRED API key required — set the fred provider key in Settings → Market Data (free at fred.stlouisfed.org).')
    }
    const dataMap = await fetchFredMultiSeries(['TREAST', 'WSHOMCB', 'WSHOFADSL', 'WALCL'], apiKey, {
      startDate: query.date ?? undefined,
      endDate: query.date ?? undefined,
      limit: query.date ? undefined : 120, // ~2 years weekly when no date pinned
    })

    const results = Object.entries(dataMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({
        date,
        treasury_holding_value: values.TREAST ?? null,
        mbs_holding_value: values.WSHOMCB ?? null,
        agency_holding_value: values.WSHOFADSL ?? null,
        total_assets: values.WALCL ?? null,
      }))

    if (results.length === 0) throw new EmptyDataError('No Fed holdings data found.')
    return results
  }

  static override transformData(
    _query: FedCentralBankHoldingsQueryParams,
    data: Record<string, unknown>[],
  ): FedCentralBankHoldingsData[] {
    return data
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => FedCentralBankHoldingsDataSchema.parse(d))
  }
}
