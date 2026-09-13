/**
 * Deribit Provider Module.
 * Maps to: openbb_platform/providers/deribit/openbb_deribit/__init__.py
 *
 * Deribit provides free crypto derivatives data (futures & options).
 * No credentials required.
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { DeribitFuturesCurveFetcher } from './models/futures-curve.js'
import { DeribitFuturesInfoFetcher } from './models/futures-info.js'
import { DeribitFuturesInstrumentsFetcher } from './models/futures-instruments.js'
import { DeribitOptionsChainsFetcher } from './models/options-chains.js'

export const deribitProvider = new Provider({
  name: 'deribit',
  website: 'https://www.deribit.com',
  description:
    'Unofficial Python client for Deribit public data. Not intended for trading.',
  fetcherDict: {
    FuturesCurve: DeribitFuturesCurveFetcher,
    FuturesInfo: DeribitFuturesInfoFetcher,
    FuturesInstruments: DeribitFuturesInstrumentsFetcher,
    OptionsChains: DeribitOptionsChainsFetcher,
  },
})
