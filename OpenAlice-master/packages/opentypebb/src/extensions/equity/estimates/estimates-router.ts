/**
 * Equity Estimates Router.
 * Maps to: openbb_equity/estimates/estimates_router.py
 */

import { Router } from '../../../core/app/router.js'

export const estimatesRouter = new Router({
  prefix: '/estimates',
  description: 'Analyst estimates and price targets.',
})

estimatesRouter.command({
  model: 'PriceTarget',
  path: '/price_target',
  description: 'Get analyst price targets by company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'PriceTarget', params, credentials)
  },
})

estimatesRouter.command({
  model: 'AnalystEstimates',
  path: '/historical',
  description: 'Get historical analyst estimates for earnings and revenue.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'AnalystEstimates', params, credentials)
  },
})

estimatesRouter.command({
  model: 'PriceTargetConsensus',
  path: '/consensus',
  description: 'Get consensus price target and recommendation.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'PriceTargetConsensus', params, credentials)
  },
})

estimatesRouter.command({
  model: 'AnalystSearch',
  path: '/analyst_search',
  description: 'Search for specific analysts and get their forecast track record.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'AnalystSearch', params, credentials)
  },
})

estimatesRouter.command({
  model: 'ForwardSalesEstimates',
  path: '/forward_sales',
  description: 'Get forward sales estimates.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ForwardSalesEstimates', params, credentials)
  },
})

estimatesRouter.command({
  model: 'ForwardEbitdaEstimates',
  path: '/forward_ebitda',
  description: 'Get forward EBITDA estimates.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ForwardEbitdaEstimates', params, credentials)
  },
})

estimatesRouter.command({
  model: 'ForwardEpsEstimates',
  path: '/forward_eps',
  description: 'Get forward EPS estimates.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ForwardEpsEstimates', params, credentials)
  },
})

estimatesRouter.command({
  model: 'ForwardPeEstimates',
  path: '/forward_pe',
  description: 'Get forward PE estimates.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ForwardPeEstimates', params, credentials)
  },
})
