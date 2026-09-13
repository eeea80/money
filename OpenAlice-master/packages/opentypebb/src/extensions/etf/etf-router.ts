/**
 * ETF Router.
 * Maps to: openbb_platform/extensions/etf/etf_router.py
 */

import { Router } from '../../core/app/router.js'

export const etfRouter = new Router({
  prefix: '/etf',
  description: 'Exchange Traded Fund (ETF) data.',
})

etfRouter.command({
  model: 'EtfSearch',
  path: '/search',
  description: 'Search for ETFs.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EtfSearch', params, credentials)
  },
})

etfRouter.command({
  model: 'EtfInfo',
  path: '/info',
  description: 'Get ETF information.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EtfInfo', params, credentials)
  },
})

etfRouter.command({
  model: 'EtfHoldings',
  path: '/holdings',
  description: 'Get an ETF holdings data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EtfHoldings', params, credentials)
  },
})

etfRouter.command({
  model: 'EtfSectors',
  path: '/sectors',
  description: 'Get ETF sector weightings.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EtfSectors', params, credentials)
  },
})

etfRouter.command({
  model: 'EtfCountries',
  path: '/countries',
  description: 'Get ETF country weightings.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EtfCountries', params, credentials)
  },
})

etfRouter.command({
  model: 'EtfEquityExposure',
  path: '/equity_exposure',
  description: 'Get the ETF equity exposure data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EtfEquityExposure', params, credentials)
  },
})

etfRouter.command({
  model: 'EtfHistorical',
  path: '/historical',
  description: 'Get historical ETF data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EtfHistorical', params, credentials)
  },
})
