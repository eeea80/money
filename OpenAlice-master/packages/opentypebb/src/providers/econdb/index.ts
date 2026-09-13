/**
 * EconDB Provider Module.
 * Maps to: openbb_platform/providers/econdb/openbb_econdb/__init__.py
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { EconDBAvailableIndicatorsFetcher } from './models/available-indicators.js'
import { EconDBCountryProfileFetcher } from './models/country-profile.js'
import { EconDBExportDestinationsFetcher } from './models/export-destinations.js'
import { EconDBEconomicIndicatorsFetcher } from './models/economic-indicators.js'

export const econdbProvider = new Provider({
  name: 'econdb',
  website: 'https://www.econdb.com',
  description: 'EconDB provides economic data aggregated from official sources.',
  credentials: ['api_key'],
  fetcherDict: {
    AvailableIndicators: EconDBAvailableIndicatorsFetcher,
    CountryProfile: EconDBCountryProfileFetcher,
    ExportDestinations: EconDBExportDestinationsFetcher,
    EconomicIndicators: EconDBEconomicIndicatorsFetcher,
  },
})
