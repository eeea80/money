/**
 * Deribit Futures Instruments Model.
 * Maps to: openbb_deribit/models/futures_instruments.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getAllFuturesInstruments } from '../utils/helpers.js'

export const DeribitFuturesInstrumentsQueryParamsSchema = z.object({}).passthrough()

export type DeribitFuturesInstrumentsQueryParams = z.infer<typeof DeribitFuturesInstrumentsQueryParamsSchema>

export const DeribitFuturesInstrumentsDataSchema = z.object({
  instrument_id: z.number().describe('Deribit Instrument ID.'),
  symbol: z.string().describe('Instrument name.'),
  base_currency: z.string().describe('The underlying currency being traded.'),
  counter_currency: z.string().describe('Counter currency for the instrument.'),
  quote_currency: z.string().describe('Quote currency.'),
  settlement_currency: z.string().nullable().default(null).describe('Settlement currency.'),
  future_type: z.string().describe('Type: linear or reversed.'),
  settlement_period: z.string().nullable().default(null).describe('The settlement period.'),
  price_index: z.string().describe('Name of price index used.'),
  contract_size: z.number().describe('Contract size.'),
  is_active: z.boolean().describe('Whether the instrument can be traded.'),
  creation_timestamp: z.number().describe('Creation timestamp (ms since epoch).'),
  expiration_timestamp: z.number().nullable().default(null).describe('Expiration timestamp (ms since epoch).'),
  tick_size: z.number().describe('Minimal price change.'),
  min_trade_amount: z.number().describe('Minimum trading amount in USD.'),
  max_leverage: z.number().describe('Maximal leverage.'),
  maker_commission: z.number().nullable().default(null).describe('Maker commission.'),
  taker_commission: z.number().nullable().default(null).describe('Taker commission.'),
}).passthrough()

export type DeribitFuturesInstrumentsData = z.infer<typeof DeribitFuturesInstrumentsDataSchema>

export class DeribitFuturesInstrumentsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): DeribitFuturesInstrumentsQueryParams {
    return DeribitFuturesInstrumentsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    _query: DeribitFuturesInstrumentsQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const data = await getAllFuturesInstruments()
    if (data.length === 0) throw new EmptyDataError('No instruments found.')
    return data
  }

  static override transformData(
    _query: DeribitFuturesInstrumentsQueryParams,
    data: Record<string, unknown>[],
  ): DeribitFuturesInstrumentsData[] {
    return data.map(d => {
      // Sentinel value for perpetual expiration
      const expTs = d.expiration_timestamp as number
      const expiration = expTs === 32503708800000 ? null : expTs

      return DeribitFuturesInstrumentsDataSchema.parse({
        ...d,
        symbol: d.instrument_name,
        expiration_timestamp: expiration,
      })
    })
  }
}
