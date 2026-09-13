/**
 * EconDB Country Profile Model.
 * Maps to: openbb_econdb/models/country_profile.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CountryProfileDataSchema } from '../../../standard-models/country-profile.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'

export const EconDBCountryProfileQueryParamsSchema = z.object({
  country: z.string().transform(v => v.toLowerCase().replace(/ /g, '_')).describe('The country to get data for.'),
}).passthrough()

export type EconDBCountryProfileQueryParams = z.infer<typeof EconDBCountryProfileQueryParamsSchema>
export type EconDBCountryProfileData = z.infer<typeof CountryProfileDataSchema>

const COUNTRY_ISO: Record<string, string> = {
  united_states: 'US', united_kingdom: 'GB', japan: 'JP', germany: 'DE',
  france: 'FR', italy: 'IT', canada: 'CA', australia: 'AU',
  south_korea: 'KR', mexico: 'MX', brazil: 'BR', china: 'CN',
  india: 'IN', turkey: 'TR', south_africa: 'ZA', russia: 'RU',
  spain: 'ES', netherlands: 'NL', switzerland: 'CH', sweden: 'SE',
}

export class EconDBCountryProfileFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): EconDBCountryProfileQueryParams {
    return EconDBCountryProfileQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: EconDBCountryProfileQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const iso = COUNTRY_ISO[query.country] ?? query.country.toUpperCase().slice(0, 2)
    const token = credentials?.econdb_api_key ?? ''
    const tokenParam = token ? `&token=${token}` : ''
    const url = `https://www.econdb.com/api/country/${iso}/?format=json${tokenParam}`

    try {
      const data = await amakeRequest<Record<string, unknown>>(url)
      return [{ ...data, country: query.country }]
    } catch (err) {
      throw new EmptyDataError(`Failed to fetch EconDB country profile: ${err}`)
    }
  }

  static override transformData(
    _query: EconDBCountryProfileQueryParams,
    data: Record<string, unknown>[],
  ): EconDBCountryProfileData[] {
    if (data.length === 0) throw new EmptyDataError()
    return data.map(d => CountryProfileDataSchema.parse({
      country: d.country ?? '',
      population: d.population ?? null,
      gdp_usd: d.gdp ?? null,
      gdp_qoq: d.gdp_qoq ?? null,
      gdp_yoy: d.gdp_yoy ?? null,
      cpi_yoy: d.cpi ?? null,
      core_yoy: d.core_cpi ?? null,
      retail_sales_yoy: d.retail_sales ?? null,
      industrial_production_yoy: d.industrial_production ?? null,
      policy_rate: d.interest_rate ?? null,
      yield_10y: d.bond_yield_10y ?? null,
      govt_debt_gdp: d.govt_debt ?? null,
      current_account_gdp: d.current_account ?? null,
      jobless_rate: d.unemployment ?? null,
    }))
  }
}
