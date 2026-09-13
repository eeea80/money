/**
 * Economy Survey Sub-Router.
 * Maps to: openbb_economy/survey/survey_router.py
 */

import { Router } from '../../../core/app/router.js'

export const surveyRouter = new Router({
  prefix: '/survey',
  description: 'Economic survey data.',
})

surveyRouter.command({
  model: 'NonfarmPayrolls',
  path: '/nonfarm_payrolls',
  description: 'Get nonfarm payrolls data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'NonfarmPayrolls', params, credentials)
  },
})

surveyRouter.command({
  model: 'InflationExpectations',
  path: '/inflation_expectations',
  description: 'Get inflation expectations data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'InflationExpectations', params, credentials)
  },
})

surveyRouter.command({
  model: 'Sloos',
  path: '/sloos',
  description: 'Get Senior Loan Officer Opinion Survey (SLOOS) data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'Sloos', params, credentials)
  },
})

surveyRouter.command({
  model: 'UniversityOfMichigan',
  path: '/university_of_michigan',
  description: 'Get University of Michigan Consumer Sentiment data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'UniversityOfMichigan', params, credentials)
  },
})

surveyRouter.command({
  model: 'EconomicConditionsChicago',
  path: '/economic_conditions_chicago',
  description: 'Get Chicago Fed National Activity Index data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EconomicConditionsChicago', params, credentials)
  },
})

surveyRouter.command({
  model: 'ManufacturingOutlookTexas',
  path: '/manufacturing_outlook_texas',
  description: 'Get Dallas Fed Manufacturing Outlook Survey data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ManufacturingOutlookTexas', params, credentials)
  },
})

surveyRouter.command({
  model: 'ManufacturingOutlookNY',
  path: '/manufacturing_outlook_ny',
  description: 'Get NY Fed Empire State Manufacturing Survey data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ManufacturingOutlookNY', params, credentials)
  },
})

surveyRouter.command({
  model: 'BlsSeries',
  path: '/bls_series',
  description: 'Get BLS time series data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'BlsSeries', params, credentials)
  },
})

surveyRouter.command({
  model: 'BlsSearch',
  path: '/bls_search',
  description: 'Search BLS data series.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'BlsSearch', params, credentials)
  },
})
