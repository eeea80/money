/**
 * Commodity Price Sub-Router.
 * Maps to: openbb_commodity/price/
 */

import { Router } from '../../../core/app/router.js'

export const commodityPriceRouter = new Router({
  prefix: '/price',
  description: 'Commodity price data.',
})

commodityPriceRouter.command({
  model: 'CommoditySpotPrice',
  path: '/spot',
  description: 'Get historical spot/futures prices for commodities.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CommoditySpotPrice', params, credentials)
  },
})
