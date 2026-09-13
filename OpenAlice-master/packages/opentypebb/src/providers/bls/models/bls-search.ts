/**
 * BLS Search Fetcher.
 * BLS doesn't have a search API, so we provide a curated list of common series.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { BlsSearchQueryParamsSchema, BlsSearchDataSchema } from '../../../standard-models/bls-search.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'

export const BLSBlsSearchQueryParamsSchema = BlsSearchQueryParamsSchema
export type BLSBlsSearchQueryParams = z.infer<typeof BLSBlsSearchQueryParamsSchema>

// Curated list of commonly used BLS series
const COMMON_SERIES = [
  { series_id: 'CUUR0000SA0', title: 'CPI-U All Items (Urban Consumers)', survey_abbreviation: 'CU' },
  { series_id: 'CUUR0000SA0L1E', title: 'CPI-U Core (Less Food and Energy)', survey_abbreviation: 'CU' },
  { series_id: 'LNS14000000', title: 'Unemployment Rate (Seasonally Adjusted)', survey_abbreviation: 'LN' },
  { series_id: 'CES0000000001', title: 'Total Nonfarm Payrolls', survey_abbreviation: 'CE' },
  { series_id: 'CES0500000003', title: 'Average Hourly Earnings (Private)', survey_abbreviation: 'CE' },
  { series_id: 'LNS11300000', title: 'Labor Force Participation Rate', survey_abbreviation: 'LN' },
  { series_id: 'CUSR0000SAF11', title: 'CPI Food at Home', survey_abbreviation: 'CU' },
  { series_id: 'CUUR0000SETB01', title: 'CPI Gasoline', survey_abbreviation: 'CU' },
  { series_id: 'CUUR0000SETA01', title: 'CPI New Vehicles', survey_abbreviation: 'CU' },
  { series_id: 'CUUR0000SEHA', title: 'CPI Rent of Primary Residence', survey_abbreviation: 'CU' },
  { series_id: 'JTS000000000000000JOR', title: 'JOLTS Job Openings Rate', survey_abbreviation: 'JT' },
  { series_id: 'JTS000000000000000QUR', title: 'JOLTS Quits Rate', survey_abbreviation: 'JT' },
  { series_id: 'WPUFD49104', title: 'PPI Final Demand', survey_abbreviation: 'WP' },
  { series_id: 'WPUFD49116', title: 'PPI Final Demand Less Food Energy Trade', survey_abbreviation: 'WP' },
  { series_id: 'CES0500000008', title: 'Average Weekly Hours (Private)', survey_abbreviation: 'CE' },
  { series_id: 'LNS12032194', title: 'Employment-Population Ratio', survey_abbreviation: 'LN' },
  { series_id: 'LNS13327709', title: 'U-6 Unemployment Rate', survey_abbreviation: 'LN' },
  { series_id: 'PRS85006092', title: 'Nonfarm Business Labor Productivity', survey_abbreviation: 'PR' },
  { series_id: 'EIUIR', title: 'Import Price Index', survey_abbreviation: 'EI' },
  { series_id: 'EIUXR', title: 'Export Price Index', survey_abbreviation: 'EI' },
]

export class BLSBlsSearchFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): BLSBlsSearchQueryParams {
    return BLSBlsSearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: BLSBlsSearchQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const q = query.query.toLowerCase()
    const results = COMMON_SERIES.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.series_id.toLowerCase().includes(q) ||
      s.survey_abbreviation.toLowerCase().includes(q),
    ).slice(0, query.limit)

    if (results.length === 0) throw new EmptyDataError(`No BLS series matching "${query.query}" found.`)
    return results
  }

  static override transformData(
    _query: BLSBlsSearchQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data.map(d => BlsSearchDataSchema.parse(d))
  }
}
