/**
 * Multpl Provider Module.
 * Maps to: openbb_platform/providers/multpl/openbb_multpl/__init__.py
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { MultplSP500MultiplesFetcher } from './models/sp500-multiples.js'

export const multplProvider = new Provider({
  name: 'multpl',
  website: 'https://www.multpl.com/',
  description: 'Public broad-market data published to https://multpl.com.',
  fetcherDict: {
    SP500Multiples: MultplSP500MultiplesFetcher,
  },
})
