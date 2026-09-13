/**
 * Equity Compare Router.
 * Maps to: openbb_equity/compare/compare_router.py
 */

import { Router } from '../../../core/app/router.js'

export const compareRouter = new Router({
  prefix: '/compare',
  description: 'Equity comparison data.',
})

compareRouter.command({
  model: 'EquityPeers',
  path: '/peers',
  description: 'Get the closest peers for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityPeers', params, credentials)
  },
})

compareRouter.command({
  model: 'CompareGroups',
  path: '/groups',
  description: 'Get company data grouped by sector, industry, or country.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CompareGroups', params, credentials)
  },
})

compareRouter.command({
  model: 'CompareCompanyFacts',
  path: '/company_facts',
  description: 'Compare reported company facts and fundamental data points.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CompareCompanyFacts', params, credentials)
  },
})
