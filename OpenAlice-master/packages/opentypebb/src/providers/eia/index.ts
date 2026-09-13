/**
 * EIA (Energy Information Administration) Provider Module.
 * Provides petroleum and energy data from the US EIA API.
 */

import { Provider } from '../../core/provider/abstract/provider.js'

import { EIAPetroleumStatusReportFetcher } from './models/petroleum-status-report.js'
import { EIAShortTermEnergyOutlookFetcher } from './models/short-term-energy-outlook.js'

export const eiaProvider = new Provider({
  name: 'eia',
  website: 'https://www.eia.gov',
  description:
    'The U.S. Energy Information Administration (EIA) collects, analyzes, and ' +
    'disseminates independent and impartial energy information.',
  // Plain `api_key` — Provider constructor auto-prefixes with provider name,
  // so the runtime credential field becomes `eia_api_key`. Declaring the
  // already-prefixed form here would double-prefix to `eia_eia_api_key`
  // and silently break credential propagation.
  credentials: ['api_key'],
  fetcherDict: {
    PetroleumStatusReport: EIAPetroleumStatusReportFetcher,
    ShortTermEnergyOutlook: EIAShortTermEnergyOutlookFetcher,
  },
  reprName: 'EIA',
})
