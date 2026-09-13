/**
 * FMP Equity Peers Model.
 * Maps to: openbb_fmp/models/equity_peers.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityPeersQueryParamsSchema, EquityPeersDataSchema } from '../../../standard-models/equity-peers.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  name: 'companyName',
  market_cap: 'mktCap',
}

const numOrNull = z.number().nullable().default(null)

export const FMPEquityPeersQueryParamsSchema = EquityPeersQueryParamsSchema
export type FMPEquityPeersQueryParams = z.infer<typeof FMPEquityPeersQueryParamsSchema>

export const FMPEquityPeersDataSchema = EquityPeersDataSchema.extend({
  name: z.string().nullable().default(null).describe('Name of the company.'),
  price: numOrNull.describe('Current price.'),
  market_cap: numOrNull.describe('Market capitalization.'),
}).passthrough()
export type FMPEquityPeersData = z.infer<typeof FMPEquityPeersDataSchema>

export class FMPEquityPeersFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEquityPeersQueryParams {
    return FMPEquityPeersQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEquityPeersQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(
      `https://financialmodelingprep.com/stable/stock-peers?symbol=${query.symbol}&apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPEquityPeersQueryParams,
    data: Record<string, unknown>[],
  ): FMPEquityPeersData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPEquityPeersDataSchema.parse(aliased)
    })
  }
}
