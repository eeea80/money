/**
 * Currency Price Router.
 * Maps to: openbb_currency/price/price_router.py
 */

import { Router } from '../../../core/app/router.js'

export const currencyPriceRouter = new Router({
  prefix: '/price',
  description: 'Currency price data.',
})

currencyPriceRouter.command({
  model: 'CurrencyHistorical',
  path: '/historical',
  description: 'Get historical price data for a currency pair.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CurrencyHistorical', params, credentials)
  },
})
