/**
 * Currency Router — root router for foreign exchange market data.
 * Maps to: openbb_currency/currency_router.py
 */

import { Router } from '../../core/app/router.js'
import { currencyPriceRouter } from './price/price-router.js'

export const currencyRouter = new Router({
  prefix: '/currency',
  description: 'Foreign exchange (FX) market data.',
})

// --- Include sub-routers ---

currencyRouter.includeRouter(currencyPriceRouter)

// --- Root-level commands ---

currencyRouter.command({
  model: 'CurrencyPairs',
  path: '/search',
  description: 'Search available currency pairs.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CurrencyPairs', params, credentials)
  },
})

currencyRouter.command({
  model: 'CurrencyReferenceRates',
  path: '/reference_rates',
  description: 'Get current, official, currency reference rates.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CurrencyReferenceRates', params, credentials)
  },
})

currencyRouter.command({
  model: 'CurrencySnapshots',
  path: '/snapshots',
  description: 'Get snapshots of currency exchange rates.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CurrencySnapshots', params, credentials)
  },
})
