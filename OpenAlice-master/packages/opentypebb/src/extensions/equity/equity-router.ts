/**
 * Equity Router — root router for equity market data.
 * Maps to: openbb_equity/equity_router.py
 *
 * Includes sub-routers for price, fundamental, discovery, calendar,
 * estimates, ownership, and compare.
 */

import { Router } from '../../core/app/router.js'
import { priceRouter } from './price/price-router.js'
import { fundamentalRouter } from './fundamental/fundamental-router.js'
import { discoveryRouter } from './discovery/discovery-router.js'
import { calendarRouter } from './calendar/calendar-router.js'
import { estimatesRouter } from './estimates/estimates-router.js'
import { ownershipRouter } from './ownership/ownership-router.js'
import { compareRouter } from './compare/compare-router.js'

export const equityRouter = new Router({
  prefix: '/equity',
  description: 'Equity market data.',
})

// --- Include sub-routers ---

equityRouter.includeRouter(priceRouter)
equityRouter.includeRouter(fundamentalRouter)
equityRouter.includeRouter(discoveryRouter)
equityRouter.includeRouter(calendarRouter)
equityRouter.includeRouter(estimatesRouter)
equityRouter.includeRouter(ownershipRouter)
equityRouter.includeRouter(compareRouter)

// --- Root-level commands ---

equityRouter.command({
  model: 'EquitySearch',
  path: '/search',
  description: 'Search for stock symbol, CIK, LEI, or company name.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquitySearch', params, credentials)
  },
})

equityRouter.command({
  model: 'EquityScreener',
  path: '/screener',
  description: 'Screen for companies meeting various criteria.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityScreener', params, credentials)
  },
})

equityRouter.command({
  model: 'EquityInfo',
  path: '/profile',
  description: 'Get general information about a company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EquityInfo', params, credentials)
  },
})

equityRouter.command({
  model: 'MarketSnapshots',
  path: '/market_snapshots',
  description: 'Get an updated equity market snapshot.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'MarketSnapshots', params, credentials)
  },
})

equityRouter.command({
  model: 'HistoricalMarketCap',
  path: '/historical_market_cap',
  description: 'Get the historical market cap of a ticker symbol.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'HistoricalMarketCap', params, credentials)
  },
})
