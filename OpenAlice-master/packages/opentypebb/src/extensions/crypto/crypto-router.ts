/**
 * Crypto Router — root router for cryptocurrency market data.
 * Maps to: openbb_crypto/crypto_router.py
 */

import { Router } from '../../core/app/router.js'
import { cryptoPriceRouter } from './price/price-router.js'

export const cryptoRouter = new Router({
  prefix: '/crypto',
  description: 'Cryptocurrency market data.',
})

// --- Include sub-routers ---

cryptoRouter.includeRouter(cryptoPriceRouter)

// --- Root-level commands ---

cryptoRouter.command({
  model: 'CryptoSearch',
  path: '/search',
  description: 'Search available cryptocurrency pairs within a provider.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CryptoSearch', params, credentials)
  },
})
