/**
 * Economy GDP Sub-Router.
 * Maps to: openbb_economy/gdp/gdp_router.py
 */

import { Router } from '../../../core/app/router.js'

export const gdpRouter = new Router({
  prefix: '/gdp',
  description: 'GDP data.',
})

gdpRouter.command({
  model: 'GdpForecast',
  path: '/forecast',
  description: 'Get GDP forecast data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'GdpForecast', params, credentials)
  },
})

gdpRouter.command({
  model: 'GdpNominal',
  path: '/nominal',
  description: 'Get nominal GDP data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'GdpNominal', params, credentials)
  },
})

gdpRouter.command({
  model: 'GdpReal',
  path: '/real',
  description: 'Get real GDP data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'GdpReal', params, credentials)
  },
})
