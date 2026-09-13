/**
 * FMP ETF Info Model.
 * Maps to: openbb_fmp/models/etf_info.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EtfInfoQueryParamsSchema, EtfInfoDataSchema } from '../../../standard-models/etf-info.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  issuer: 'etfCompany',
  cusip: 'securityCusip',
  isin: 'securityIsin',
  aum: 'assetsUnderManagement',
  nav: 'netAssetValue',
  currency: 'navCurrency',
  volume_avg: 'avgVolume',
  updated: 'updatedAt',
}

const numOrNull = z.number().nullable().default(null)

export const FMPEtfInfoQueryParamsSchema = EtfInfoQueryParamsSchema
export type FMPEtfInfoQueryParams = z.infer<typeof FMPEtfInfoQueryParamsSchema>

export const FMPEtfInfoDataSchema = EtfInfoDataSchema.extend({
  cusip: z.string().nullable().default(null).describe('The CUSIP of the ETF.'),
  isin: z.string().nullable().default(null).describe('The ISIN of the ETF.'),
  aum: numOrNull.describe('The assets under management of the ETF.'),
  nav: numOrNull.describe('The net asset value of the ETF.'),
  currency: z.string().nullable().default(null).describe('The currency of the ETF.'),
  expense_ratio: numOrNull.describe('The expense ratio of the ETF as a normalized percentage.'),
  holdings_count: numOrNull.describe('The number of holdings in the ETF.'),
  volume_avg: numOrNull.describe('The average volume of the ETF.'),
  updated: z.string().nullable().default(null).describe('The last updated date of the ETF.'),
  asset_class: z.string().nullable().default(null).describe('The asset class of the ETF.'),
  sector_list: z.string().nullable().default(null).describe('Sector list of the ETF.'),
}).passthrough()
export type FMPEtfInfoData = z.infer<typeof FMPEtfInfoDataSchema>

export class FMPEtfInfoFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEtfInfoQueryParams {
    return FMPEtfInfoQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEtfInfoQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const symbol = query.symbol
    return getDataMany(
      `https://financialmodelingprep.com/stable/etf/info?symbol=${symbol}&apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPEtfInfoQueryParams,
    data: Record<string, unknown>[],
  ): FMPEtfInfoData[] {
    return data.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      // Normalize expense_ratio from percent to decimal (5.0 → 0.05)
      if (typeof aliased.expense_ratio === 'number') {
        aliased.expense_ratio = aliased.expense_ratio / 100
      }
      return FMPEtfInfoDataSchema.parse(aliased)
    })
  }
}
