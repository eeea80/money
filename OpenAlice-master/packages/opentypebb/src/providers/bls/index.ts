/**
 * BLS (Bureau of Labor Statistics) Provider Module.
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { BLSBlsSeriesFetcher } from './models/bls-series.js'
import { BLSBlsSearchFetcher } from './models/bls-search.js'

export const blsProvider = new Provider({
  name: 'bls',
  website: 'https://www.bls.gov',
  description: 'Bureau of Labor Statistics — US labor market and price data.',
  credentials: ['api_key'],
  fetcherDict: {
    BlsSeries: BLSBlsSeriesFetcher,
    BlsSearch: BLSBlsSearchFetcher,
  },
})
