/**
 * Equity Calendar Router.
 * Maps to: openbb_equity/calendar/calendar_router.py
 */

import { Router } from '../../../core/app/router.js'

export const calendarRouter = new Router({
  prefix: '/calendar',
  description: 'Equity calendar data.',
})

calendarRouter.command({
  model: 'CalendarIpo',
  path: '/ipo',
  description: 'Get historical and upcoming initial public offerings (IPOs).',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CalendarIpo', params, credentials)
  },
})

calendarRouter.command({
  model: 'CalendarDividend',
  path: '/dividend',
  description: 'Get historical and upcoming dividend payments.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CalendarDividend', params, credentials)
  },
})

calendarRouter.command({
  model: 'CalendarSplits',
  path: '/splits',
  description: 'Get historical and upcoming stock split operations.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CalendarSplits', params, credentials)
  },
})

calendarRouter.command({
  model: 'CalendarEvents',
  path: '/events',
  description: 'Get historical and upcoming company events.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CalendarEvents', params, credentials)
  },
})

calendarRouter.command({
  model: 'CalendarEarnings',
  path: '/earnings',
  description: 'Get historical and upcoming company earnings releases.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CalendarEarnings', params, credentials)
  },
})
