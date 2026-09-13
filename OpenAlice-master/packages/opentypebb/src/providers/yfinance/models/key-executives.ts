/**
 * YFinance Key Executives Model.
 * Maps to: openbb_yfinance/models/key_executives.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { KeyExecutivesQueryParamsSchema, KeyExecutivesDataSchema } from '../../../standard-models/key-executives.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getRawQuoteSummary } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  year_born: 'yearBorn',
  fiscal_year: 'fiscalYear',
  pay: 'totalPay',
  exercised_value: 'exercisedValue',
  unexercised_value: 'unexercisedValue',
}

export const YFinanceKeyExecutivesQueryParamsSchema = KeyExecutivesQueryParamsSchema
export type YFinanceKeyExecutivesQueryParams = z.infer<typeof YFinanceKeyExecutivesQueryParamsSchema>

export const YFinanceKeyExecutivesDataSchema = KeyExecutivesDataSchema.extend({
  exercised_value: z.number().nullable().default(null).describe('Value of shares exercised.'),
  unexercised_value: z.number().nullable().default(null).describe('Value of shares not exercised.'),
  fiscal_year: z.number().nullable().default(null).describe('Fiscal year of the pay.'),
}).passthrough()
export type YFinanceKeyExecutivesData = z.infer<typeof YFinanceKeyExecutivesDataSchema>

export class YFinanceKeyExecutivesFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceKeyExecutivesQueryParams {
    return YFinanceKeyExecutivesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceKeyExecutivesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    // Need raw (unflattened) quoteSummary to access companyOfficers array
    const raw = await getRawQuoteSummary(query.symbol, ['assetProfile'])
    const profile = (raw as any).assetProfile
    if (!profile?.companyOfficers?.length) {
      throw new EmptyDataError(`No executive data found for ${query.symbol}`)
    }

    // Remove maxAge from each officer entry (matches Python)
    const officers: Record<string, unknown>[] = profile.companyOfficers.map((d: any) => {
      const copy = { ...d }
      delete copy.maxAge
      // Handle nested raw values (yahoo-finance2 sometimes wraps in { raw, fmt })
      for (const [k, v] of Object.entries(copy)) {
        if (v && typeof v === 'object' && 'raw' in (v as any)) {
          copy[k] = (v as any).raw
        }
      }
      return copy
    })

    return officers
  }

  static override transformData(
    _query: YFinanceKeyExecutivesQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceKeyExecutivesData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return YFinanceKeyExecutivesDataSchema.parse(aliased)
    })
  }
}
