/**
 * EconDB Export Destinations Model.
 * Maps to: openbb_econdb/models/export_destinations.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { ExportDestinationsDataSchema } from '../../../standard-models/export-destinations.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'

export const EconDBExportDestinationsQueryParamsSchema = z.object({
  country: z.string().describe('The country to get data for.'),
}).passthrough()

export type EconDBExportDestinationsQueryParams = z.infer<typeof EconDBExportDestinationsQueryParamsSchema>
export type EconDBExportDestinationsData = z.infer<typeof ExportDestinationsDataSchema>

const COUNTRY_ISO: Record<string, string> = {
  united_states: 'US', united_kingdom: 'GB', japan: 'JP', germany: 'DE',
  france: 'FR', italy: 'IT', canada: 'CA', china: 'CN',
}

export class EconDBExportDestinationsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): EconDBExportDestinationsQueryParams {
    return EconDBExportDestinationsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: EconDBExportDestinationsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const iso = COUNTRY_ISO[query.country] ?? query.country.toUpperCase().slice(0, 2)
    const token = credentials?.econdb_api_key ?? ''
    const tokenParam = token ? `&token=${token}` : ''
    const url = `https://www.econdb.com/api/country/${iso}/trade/?format=json${tokenParam}`

    try {
      const data = await amakeRequest<Record<string, unknown>>(url)
      const exports = (data.exports ?? data.results ?? []) as Record<string, unknown>[]
      if (!Array.isArray(exports) || exports.length === 0) throw new EmptyDataError()
      return exports.map(e => ({ ...e, origin_country: query.country }))
    } catch (err) {
      if (err instanceof EmptyDataError) throw err
      throw new EmptyDataError(`Failed to fetch export destinations: ${err}`)
    }
  }

  static override transformData(
    _query: EconDBExportDestinationsQueryParams,
    data: Record<string, unknown>[],
  ): EconDBExportDestinationsData[] {
    return data.map(d => ExportDestinationsDataSchema.parse({
      origin_country: d.origin_country ?? '',
      destination_country: d.partner ?? d.destination_country ?? '',
      value: d.value ?? d.amount ?? 0,
    }))
  }
}
