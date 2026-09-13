/**
 * FMP Currency Available Pairs Model.
 * Maps to: openbb_fmp/models/currency_pairs.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CurrencyPairsQueryParamsSchema, CurrencyPairsDataSchema } from '../../../standard-models/currency-pairs.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  from_currency: 'fromCurrency',
  to_currency: 'toCurrency',
  from_name: 'fromName',
  to_name: 'toName',
}

export const FMPCurrencyPairsQueryParamsSchema = CurrencyPairsQueryParamsSchema
export type FMPCurrencyPairsQueryParams = z.infer<typeof FMPCurrencyPairsQueryParamsSchema>

export const FMPCurrencyPairsDataSchema = CurrencyPairsDataSchema.extend({
  from_currency: z.string().describe('Base currency of the currency pair.'),
  to_currency: z.string().describe('Quote currency of the currency pair.'),
  from_name: z.string().describe('Name of the base currency.'),
  to_name: z.string().describe('Name of the quote currency.'),
}).passthrough()
export type FMPCurrencyPairsData = z.infer<typeof FMPCurrencyPairsDataSchema>

export class FMPCurrencyPairsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPCurrencyPairsQueryParams {
    return FMPCurrencyPairsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPCurrencyPairsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(`https://financialmodelingprep.com/stable/forex-list?apikey=${apiKey}`)
  }

  static override transformData(
    query: FMPCurrencyPairsQueryParams,
    data: Record<string, unknown>[],
  ): FMPCurrencyPairsData[] {
    if (!data || data.length === 0) {
      throw new EmptyDataError('The request was returned empty.')
    }

    let filtered = data
    if (query.query) {
      const q = query.query.toLowerCase()
      filtered = data.filter((d) =>
        String(d.symbol ?? '').toLowerCase().includes(q) ||
        String(d.fromCurrency ?? '').toLowerCase().includes(q) ||
        String(d.toCurrency ?? '').toLowerCase().includes(q) ||
        String(d.fromName ?? '').toLowerCase().includes(q) ||
        String(d.toName ?? '').toLowerCase().includes(q),
      )
    }

    if (filtered.length === 0) {
      throw new EmptyDataError(`No results were found with the query supplied. -> ${query.query}`)
    }

    return filtered.map((d) => FMPCurrencyPairsDataSchema.parse(applyAliases(d, ALIAS_DICT)))
  }
}
