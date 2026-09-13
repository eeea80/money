/**
 * Equity Ownership Router.
 * Maps to: openbb_equity/ownership/ownership_router.py
 */

import { Router } from '../../../core/app/router.js'

export const ownershipRouter = new Router({
  prefix: '/ownership',
  description: 'Equity ownership data.',
})

ownershipRouter.command({
  model: 'EquityOwnership',
  path: '/major_holders',
  description: 'Get data about major holders for a given company over time.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityOwnership', params, credentials)
  },
})

ownershipRouter.command({
  model: 'InstitutionalOwnership',
  path: '/institutional',
  description: 'Get net statistics on institutional ownership, reported on 13-F filings.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'InstitutionalOwnership', params, credentials)
  },
})

ownershipRouter.command({
  model: 'InsiderTrading',
  path: '/insider_trading',
  description: 'Get data about trading by a company\'s management team and board of directors.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'InsiderTrading', params, credentials)
  },
})

ownershipRouter.command({
  model: 'ShareStatistics',
  path: '/share_statistics',
  description: 'Get data about share float for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ShareStatistics', params, credentials)
  },
})

ownershipRouter.command({
  model: 'Form13FHR',
  path: '/form_13f',
  description: 'Get the form 13F for institutional investment managers with $100M+ AUM.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'Form13FHR', params, credentials)
  },
})

ownershipRouter.command({
  model: 'GovernmentTrades',
  path: '/government_trades',
  description: 'Get government transaction data (Senate and House of Representatives).',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'GovernmentTrades', params, credentials)
  },
})
