/**
 * FMP ESG Score Model.
 * Maps to: openbb_fmp/models/esg.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EsgScoreQueryParamsSchema, EsgScoreDataSchema } from '../../../standard-models/esg-score.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  company_name: 'companyName',
  form_type: 'formType',
  accepted_date: 'acceptedDate',
  environmental_score: 'environmentalScore',
  social_score: 'socialScore',
  governance_score: 'governanceScore',
  esg_score: 'ESGScore',
}

export const FMPEsgScoreQueryParamsSchema = EsgScoreQueryParamsSchema
export type FMPEsgScoreQueryParams = z.infer<typeof FMPEsgScoreQueryParamsSchema>

export const FMPEsgScoreDataSchema = EsgScoreDataSchema
export type FMPEsgScoreData = z.infer<typeof FMPEsgScoreDataSchema>

export class FMPEsgScoreFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEsgScoreQueryParams {
    return FMPEsgScoreQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEsgScoreQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    return getDataMany(
      `https://financialmodelingprep.com/stable/esg-disclosures?symbol=${query.symbol}&apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPEsgScoreQueryParams,
    data: Record<string, unknown>[],
  ): FMPEsgScoreData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPEsgScoreDataSchema.parse(aliased)
    })
  }
}
