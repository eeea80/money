/**
 * Commodity Router.
 * Maps to: openbb_commodity/commodity_router.py
 */

import { Router } from '../../core/app/router.js'
import { commodityPriceRouter } from './price/price-router.js'

export const commodityRouter = new Router({
  prefix: '/commodity',
  description: 'Commodity market data.',
})

// --- Include sub-routers ---
commodityRouter.includeRouter(commodityPriceRouter)

// --- Root-level commands ---

commodityRouter.command({
  model: 'PetroleumStatusReport',
  path: '/petroleum_status_report',
  description: 'Get EIA Weekly Petroleum Status Report data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'PetroleumStatusReport', params, credentials)
  },
})

commodityRouter.command({
  model: 'ShortTermEnergyOutlook',
  path: '/short_term_energy_outlook',
  description: 'Get EIA Short-Term Energy Outlook (STEO) data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ShortTermEnergyOutlook', params, credentials)
  },
})
