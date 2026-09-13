/**
 * SEC Provider.
 *
 * Source: https://www.sec.gov/
 * Free, no API key required.
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { SECEquitySearchFetcher } from './models/equity-search.js'

export const secProvider = new Provider({
  name: 'sec',
  description: 'SEC EDGAR — US public company filings and data.',
  website: 'https://www.sec.gov/',
  fetcherDict: {
    EquitySearch: SECEquitySearchFetcher,
  },
})
