/**
 * Intrinio Provider Module.
 * Maps to: openbb_platform/providers/intrinio/openbb_intrinio/__init__.py
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { IntrinioOptionsSnapshotsFetcher } from './models/options-snapshots.js'
import { IntrinioOptionsUnusualFetcher } from './models/options-unusual.js'

export const intrinioProvider = new Provider({
  name: 'intrinio',
  website: 'https://intrinio.com',
  description: 'Intrinio provides financial data and analytics APIs.',
  credentials: ['api_key'],
  fetcherDict: {
    OptionsSnapshots: IntrinioOptionsSnapshotsFetcher,
    OptionsUnusual: IntrinioOptionsUnusualFetcher,
  },
})
