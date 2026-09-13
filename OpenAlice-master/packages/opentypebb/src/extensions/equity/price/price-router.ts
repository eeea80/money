/**
 * Equity Price Router.
 * Maps to: openbb_equity/price/price_router.py
 */

import { Router } from '../../../core/app/router.js'

export const priceRouter = new Router({
  prefix: '/price',
  description: 'Equity price data.',
})

priceRouter.command({
  model: 'EquityQuote',
  path: '/quote',
  description: 'Get the latest quote for a given stock. This includes price, volume, and other data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityQuote', params, credentials)
  },
})

priceRouter.command({
  model: 'EquityNBBO',
  path: '/nbbo',
  description: 'Get the National Best Bid and Offer for a given stock.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityNBBO', params, credentials)
  },
})

priceRouter.command({
  model: 'EquityHistorical',
  path: '/historical',
  description: 'Get historical price data for a given stock. This includes open, high, low, close, and volume.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityHistorical', params, credentials)
  },
})

priceRouter.command({
  model: 'PricePerformance',
  path: '/performance',
  description: 'Get price performance data for a given stock over various time periods.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'PricePerformance', params, credentials)
  },
})
