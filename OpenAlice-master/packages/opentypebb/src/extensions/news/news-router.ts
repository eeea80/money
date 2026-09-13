/**
 * News Router — root router for financial news data.
 * Maps to: openbb_news/news_router.py
 */

import { Router } from '../../core/app/router.js'

export const newsRouter = new Router({
  prefix: '/news',
  description: 'Financial market news data.',
})

newsRouter.command({
  model: 'WorldNews',
  path: '/world',
  description: 'Get global news data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'WorldNews', params, credentials)
  },
})

newsRouter.command({
  model: 'CompanyNews',
  path: '/company',
  description: 'Get news for one or more companies.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CompanyNews', params, credentials)
  },
})
