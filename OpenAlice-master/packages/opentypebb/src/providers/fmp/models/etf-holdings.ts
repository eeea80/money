/**
 * FMP ETF Holdings Model.
 * Maps to: openbb_fmp/models/etf_holdings.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EtfHoldingsQueryParamsSchema, EtfHoldingsDataSchema } from '../../../standard-models/etf-holdings.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  shares: 'sharesNumber',
  value: 'marketValue',
  weight: 'weightPercentage',
  symbol: 'asset',
  updated: 'updatedAt',
  cusip: 'securityCusip',
}

const numOrNull = z.number().nullable().default(null)

export const FMPEtfHoldingsQueryParamsSchema = EtfHoldingsQueryParamsSchema.extend({
  date: z.string().nullable().default(null).describe('A specific date to get data for. Entering a date will attempt to return the NPORT filing for the entered date. This needs to be exact date of the filing. Defaults to the latest filing.'),
  cik: z.string().nullable().default(null).describe('The CIK number of the filing entity.'),
})
export type FMPEtfHoldingsQueryParams = z.infer<typeof FMPEtfHoldingsQueryParamsSchema>

export const FMPEtfHoldingsDataSchema = EtfHoldingsDataSchema.extend({
  shares: numOrNull.describe('The number of shares held.'),
  value: numOrNull.describe('The market value of the holding.'),
  weight: numOrNull.describe('The weight of the holding in the ETF as a normalized percentage.'),
  updated: z.string().nullable().default(null).describe('The last updated date.'),
  cusip: z.string().nullable().default(null).describe('The CUSIP of the holding.'),
  isin: z.string().nullable().default(null).describe('The ISIN of the holding.'),
  country: z.string().nullable().default(null).describe('The country of the holding.'),
  exchange: z.string().nullable().default(null).describe('The exchange of the holding.'),
  asset_type: z.string().nullable().default(null).describe('The asset type of the holding.'),
}).passthrough()
export type FMPEtfHoldingsData = z.infer<typeof FMPEtfHoldingsDataSchema>

export class FMPEtfHoldingsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEtfHoldingsQueryParams {
    return FMPEtfHoldingsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEtfHoldingsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const symbol = query.symbol
    let url = `https://financialmodelingprep.com/stable/etf/holdings?symbol=${symbol}&apikey=${apiKey}`
    if (query.date) url += `&date=${query.date}`
    if (query.cik) url += `&cik=${query.cik}`
    return getDataMany(url)
  }

  static override transformData(
    _query: FMPEtfHoldingsQueryParams,
    data: Record<string, unknown>[],
  ): FMPEtfHoldingsData[] {
    return data.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      // Normalize weight from percent to decimal (5.0 → 0.05)
      if (typeof aliased.weight === 'number') {
        aliased.weight = aliased.weight / 100
      }
      return FMPEtfHoldingsDataSchema.parse(aliased)
    })
  }
}
