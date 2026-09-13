/**
 * Yahoo Finance ETF Holdings Model.
 *
 * Keyless fallback for the FMP holdings endpoint. Yahoo's quoteSummary
 * `topHoldings` module only carries the TOP-10 positions (vs FMP's full
 * list) — good enough for the concentration read the tool exists for.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EtfHoldingsQueryParamsSchema, EtfHoldingsDataSchema } from '../../../standard-models/etf-holdings.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getRawQuoteSummary } from '../utils/helpers.js'

export const YFEtfHoldingsQueryParamsSchema = EtfHoldingsQueryParamsSchema
export type YFEtfHoldingsQueryParams = z.infer<typeof YFEtfHoldingsQueryParamsSchema>

export const YFEtfHoldingsDataSchema = EtfHoldingsDataSchema.passthrough()
export type YFEtfHoldingsData = z.infer<typeof YFEtfHoldingsDataSchema>

export class YFEtfHoldingsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFEtfHoldingsQueryParams {
    return YFEtfHoldingsQueryParamsSchema.parse(params)
  }

  static override async extractData(query: YFEtfHoldingsQueryParams): Promise<Record<string, unknown>[]> {
    const summary = await getRawQuoteSummary(query.symbol, ['topHoldings'])
    const holdings = (summary.topHoldings?.holdings ?? []) as Array<Record<string, unknown>>
    if (holdings.length === 0) {
      throw new EmptyDataError(`No holdings data for ${query.symbol} (Yahoo carries holdings for funds/ETFs only).`)
    }
    return holdings
  }

  static override transformData(
    _query: YFEtfHoldingsQueryParams,
    data: Record<string, unknown>[],
  ): YFEtfHoldingsData[] {
    return data.map((d) =>
      YFEtfHoldingsDataSchema.parse({
        symbol: d.symbol ?? null,
        name: d.holdingName ?? null,
        // Decimal fraction (0.0789 = 7.89%) — same normalization as FMP.
        weight: typeof d.holdingPercent === 'number' ? d.holdingPercent : null,
      }),
    )
  }
}
