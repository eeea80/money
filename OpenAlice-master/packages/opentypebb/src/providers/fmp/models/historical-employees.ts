/**
 * FMP Historical Employees Model.
 * Maps to: openbb_fmp/models/historical_employees.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { HistoricalEmployeesQueryParamsSchema, HistoricalEmployeesDataSchema } from '../../../standard-models/historical-employees.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  company_name: 'companyName',
  employees: 'employeeCount',
  date: 'periodOfReport',
  source: 'formType',
  url: 'source',
}

export const FMPHistoricalEmployeesQueryParamsSchema = HistoricalEmployeesQueryParamsSchema.extend({
  limit: z.coerce.number().nullable().default(null).describe('The number of data entries to return.'),
})
export type FMPHistoricalEmployeesQueryParams = z.infer<typeof FMPHistoricalEmployeesQueryParamsSchema>

export const FMPHistoricalEmployeesDataSchema = HistoricalEmployeesDataSchema.extend({
  company_name: z.string().nullable().default(null).describe('Name of the company.'),
  source: z.string().nullable().default(null).describe('Source form type.'),
  url: z.string().nullable().default(null).describe('URL to the source filing.'),
}).passthrough()
export type FMPHistoricalEmployeesData = z.infer<typeof FMPHistoricalEmployeesDataSchema>

export class FMPHistoricalEmployeesFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPHistoricalEmployeesQueryParams {
    return FMPHistoricalEmployeesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPHistoricalEmployeesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    let url = `https://financialmodelingprep.com/stable/historical-employee-count?symbol=${query.symbol}&apikey=${apiKey}`
    if (query.limit) url += `&limit=${query.limit}`
    return getDataMany(url)
  }

  static override transformData(
    _query: FMPHistoricalEmployeesQueryParams,
    data: Record<string, unknown>[],
  ): FMPHistoricalEmployeesData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPHistoricalEmployeesDataSchema.parse(aliased)
    })
  }
}
