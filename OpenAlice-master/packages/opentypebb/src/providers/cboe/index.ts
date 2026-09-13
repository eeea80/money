/**
 * CBOE Provider Module.
 * Maps to: openbb_platform/providers/cboe/openbb_cboe/__init__.py
 *
 * We only implement IndexSearch here. The full CBOE provider in Python
 * has 11 endpoints, but we only need the missing ones.
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { CboeIndexSearchFetcher } from './models/index-search.js'

export const cboeProvider = new Provider({
  name: 'cboe',
  website: 'https://www.cboe.com',
  description:
    'Cboe is the world\'s go-to derivatives and exchange network, ' +
    'delivering cutting-edge trading, clearing and investment solutions.',
  reprName: 'Chicago Board Options Exchange (CBOE)',
  fetcherDict: {
    IndexSearch: CboeIndexSearchFetcher,
  },
})
