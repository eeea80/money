/**
 * ECB Provider Module.
 * Maps to: openbb_platform/providers/ecb/openbb_ecb/__init__.py
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { ECBBalanceOfPaymentsFetcher } from './models/balance-of-payments.js'

export const ecbProvider = new Provider({
  name: 'ecb',
  website: 'https://data.ecb.europa.eu',
  description: 'European Central Bank data portal.',
  fetcherDict: {
    BalanceOfPayments: ECBBalanceOfPaymentsFetcher,
  },
})
