/**
 * YFinance Price Target Consensus Model.
 * Maps to: openbb_yfinance/models/price_target_consensus.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { PriceTargetConsensusQueryParamsSchema, PriceTargetConsensusDataSchema } from '../../../standard-models/price-target-consensus.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getQuoteSummary } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  target_high: 'targetHighPrice',
  target_low: 'targetLowPrice',
  target_consensus: 'targetMeanPrice',
  target_median: 'targetMedianPrice',
  recommendation: 'recommendationKey',
  recommendation_mean: 'recommendationMean',
  number_of_analysts: 'numberOfAnalystOpinions',
  current_price: 'currentPrice',
}

export const YFinancePriceTargetConsensusQueryParamsSchema = PriceTargetConsensusQueryParamsSchema
export type YFinancePriceTargetConsensusQueryParams = z.infer<typeof YFinancePriceTargetConsensusQueryParamsSchema>

export const YFinancePriceTargetConsensusDataSchema = PriceTargetConsensusDataSchema.extend({
  recommendation: z.string().nullable().default(null).describe('Recommendation - buy, sell, etc.'),
  recommendation_mean: z.number().nullable().default(null).describe('Mean recommendation score where 1 is strong buy and 5 is strong sell.'),
  number_of_analysts: z.number().nullable().default(null).describe('Number of analysts providing opinions.'),
  current_price: z.number().nullable().default(null).describe('Current price of the stock.'),
  currency: z.string().nullable().default(null).describe('Currency the stock is priced in.'),
}).passthrough()
export type YFinancePriceTargetConsensusData = z.infer<typeof YFinancePriceTargetConsensusDataSchema>

export class YFinancePriceTargetConsensusFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinancePriceTargetConsensusQueryParams {
    if (!params.symbol) throw new Error('Symbol is a required field for yFinance.')
    return YFinancePriceTargetConsensusQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinancePriceTargetConsensusQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbols = (query.symbol ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const results = await Promise.allSettled(
      symbols.map(s => getQuoteSummary(s, ['financialData']))
    )
    const data: Record<string, unknown>[] = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.numberOfAnalystOpinions != null) {
        data.push(r.value)
      }
    }
    return data
  }

  static override transformData(
    query: YFinancePriceTargetConsensusQueryParams,
    data: Record<string, unknown>[],
  ): YFinancePriceTargetConsensusData[] {
    if (!data.length) throw new EmptyDataError('No price target data returned')
    return data.map(d => YFinancePriceTargetConsensusDataSchema.parse(applyAliases(d, ALIAS_DICT)))
  }
}
