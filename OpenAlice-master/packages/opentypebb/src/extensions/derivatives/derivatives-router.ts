/**
 * Derivatives Router — root router for derivatives market data.
 * Maps to: openbb_derivatives/derivatives_router.py
 */

import { Router } from '../../core/app/router.js'

export const derivativesRouter = new Router({
  prefix: '/derivatives',
  description: 'Derivatives market data.',
})

derivativesRouter.command({
  model: 'FuturesHistorical',
  path: '/futures/historical',
  description: 'Get historical price data for futures contracts.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'FuturesHistorical', params, credentials)
  },
})

derivativesRouter.command({
  model: 'FuturesCurve',
  path: '/futures/curve',
  description: 'Get the futures term structure (curve) for a symbol.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'FuturesCurve', params, credentials)
  },
})

derivativesRouter.command({
  model: 'FuturesInfo',
  path: '/futures/info',
  description: 'Get information about futures contracts.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'FuturesInfo', params, credentials)
  },
})

derivativesRouter.command({
  model: 'FuturesInstruments',
  path: '/futures/instruments',
  description: 'Get the list of available futures instruments.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'FuturesInstruments', params, credentials)
  },
})

derivativesRouter.command({
  model: 'OptionsChains',
  path: '/options/chains',
  description: 'Get the complete options chain for a given symbol.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'OptionsChains', params, credentials)
  },
})

derivativesRouter.command({
  model: 'OptionsSnapshots',
  path: '/options/snapshots',
  description: 'Get current snapshot data for options.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'OptionsSnapshots', params, credentials)
  },
})

derivativesRouter.command({
  model: 'OptionsUnusual',
  path: '/options/unusual',
  description: 'Get unusual options activity data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'OptionsUnusual', params, credentials)
  },
})
