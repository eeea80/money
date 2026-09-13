/**
 * Index Router — root router for index market data.
 * Maps to: openbb_index/index_router.py
 */

import { Router } from '../../core/app/router.js'

export const indexRouter = new Router({
  prefix: '/index',
  description: 'Index market data.',
})

indexRouter.command({
  model: 'AvailableIndices',
  path: '/available',
  description: 'Get the list of available indices.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'AvailableIndices', params, credentials)
  },
})

indexRouter.command({
  model: 'IndexConstituents',
  path: '/constituents',
  description: 'Get the constituents of an index.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'IndexConstituents', params, credentials)
  },
})

indexRouter.command({
  model: 'IndexHistorical',
  path: '/price/historical',
  description: 'Get historical price data for an index.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'IndexHistorical', params, credentials)
  },
})

indexRouter.command({
  model: 'IndexSnapshots',
  path: '/snapshots',
  description: 'Get current snapshot data for indices.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'IndexSnapshots', params, credentials)
  },
})

indexRouter.command({
  model: 'RiskPremium',
  path: '/risk_premium',
  description: 'Get market risk premium data by country.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'RiskPremium', params, credentials)
  },
})

indexRouter.command({
  model: 'IndexSearch',
  path: '/search',
  description: 'Search for indices by name or symbol.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'IndexSearch', params, credentials)
  },
})

indexRouter.command({
  model: 'IndexSectors',
  path: '/sectors',
  description: 'Get sector weightings for an index.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'IndexSectors', params, credentials)
  },
})

indexRouter.command({
  model: 'SP500Multiples',
  path: '/sp500_multiples',
  description: 'Get historical S&P 500 multiples (PE ratio, earnings yield, etc).',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'SP500Multiples', params, credentials)
  },
})
