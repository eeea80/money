/**
 * Equity Discovery Router.
 * Maps to: openbb_equity/discovery/discovery_router.py
 */

import { Router } from '../../../core/app/router.js'

export const discoveryRouter = new Router({
  prefix: '/discovery',
  description: 'Equity discovery data.',
})

discoveryRouter.command({
  model: 'EquityGainers',
  path: '/gainers',
  description: 'Get the top price gainers in the stock market.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityGainers', params, credentials)
  },
})

discoveryRouter.command({
  model: 'EquityLosers',
  path: '/losers',
  description: 'Get the top price losers in the stock market.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityLosers', params, credentials)
  },
})

discoveryRouter.command({
  model: 'EquityActive',
  path: '/active',
  description: 'Get the most actively traded stocks based on volume.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityActive', params, credentials)
  },
})

discoveryRouter.command({
  model: 'EquityUndervaluedLargeCaps',
  path: '/undervalued_large_caps',
  description: 'Get potentially undervalued large cap stocks.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityUndervaluedLargeCaps', params, credentials)
  },
})

discoveryRouter.command({
  model: 'EquityUndervaluedGrowth',
  path: '/undervalued_growth',
  description: 'Get potentially undervalued growth stocks.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityUndervaluedGrowth', params, credentials)
  },
})

discoveryRouter.command({
  model: 'EquityAggressiveSmallCaps',
  path: '/aggressive_small_caps',
  description: 'Get top small cap stocks based on earnings growth.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityAggressiveSmallCaps', params, credentials)
  },
})

discoveryRouter.command({
  model: 'GrowthTechEquities',
  path: '/growth_tech',
  description: 'Get top tech stocks based on revenue and earnings growth.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'GrowthTechEquities', params, credentials)
  },
})

discoveryRouter.command({
  model: 'TopRetail',
  path: '/top_retail',
  description: 'Track over $30B USD/day of individual investors trades.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'TopRetail', params, credentials)
  },
})

discoveryRouter.command({
  model: 'DiscoveryFilings',
  path: '/filings',
  description: 'Get the URLs to SEC filings reported to the EDGAR database.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'DiscoveryFilings', params, credentials)
  },
})

discoveryRouter.command({
  model: 'LatestFinancialReports',
  path: '/latest_financial_reports',
  description: 'Get the newest quarterly, annual, and current reports for all companies.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'LatestFinancialReports', params, credentials)
  },
})
