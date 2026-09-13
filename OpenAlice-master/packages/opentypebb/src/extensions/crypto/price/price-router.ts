/**
 * Crypto Price Router.
 * Maps to: openbb_crypto/price/price_router.py
 */

import { Router } from '../../../core/app/router.js'

export const cryptoPriceRouter = new Router({
  prefix: '/price',
  description: 'Cryptocurrency price data.',
})

cryptoPriceRouter.command({
  model: 'CryptoHistorical',
  path: '/historical',
  description: 'Get historical price data for cryptocurrency pair(s).',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CryptoHistorical', params, credentials)
  },
})
