/**
 * Equity Fundamental Router.
 * Maps to: openbb_equity/fundamental/fundamental_router.py
 */

import { Router } from '../../../core/app/router.js'

export const fundamentalRouter = new Router({
  prefix: '/fundamental',
  description: 'Fundamental analysis data.',
})

fundamentalRouter.command({
  model: 'BalanceSheet',
  path: '/balance',
  description: 'Get the balance sheet for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'BalanceSheet', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'BalanceSheetGrowth',
  path: '/balance_growth',
  description: 'Get the growth of a company\'s balance sheet items over time.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'BalanceSheetGrowth', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'CashFlowStatement',
  path: '/cash',
  description: 'Get the cash flow statement for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CashFlowStatement', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'ReportedFinancials',
  path: '/reported_financials',
  description: 'Get financial statements as reported by the company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ReportedFinancials', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'CashFlowStatementGrowth',
  path: '/cash_growth',
  description: 'Get the growth of a company\'s cash flow statement items over time.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CashFlowStatementGrowth', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'HistoricalDividends',
  path: '/dividends',
  description: 'Get historical dividend data for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'HistoricalDividends', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'HistoricalEps',
  path: '/historical_eps',
  description: 'Get historical earnings per share data for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'HistoricalEps', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'HistoricalEmployees',
  path: '/employee_count',
  description: 'Get historical employee count data for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'HistoricalEmployees', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'SearchAttributes',
  path: '/search_attributes',
  description: 'Search Intrinio data tags to search in latest or historical attributes.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'SearchAttributes', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'LatestAttributes',
  path: '/latest_attributes',
  description: 'Get the latest value of a data tag from Intrinio.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'LatestAttributes', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'HistoricalAttributes',
  path: '/historical_attributes',
  description: 'Get the historical values of a data tag from Intrinio.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'HistoricalAttributes', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'IncomeStatement',
  path: '/income',
  description: 'Get the income statement for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'IncomeStatement', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'IncomeStatementGrowth',
  path: '/income_growth',
  description: 'Get the growth of a company\'s income statement items over time.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'IncomeStatementGrowth', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'KeyMetrics',
  path: '/metrics',
  description: 'Get fundamental metrics for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'KeyMetrics', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'KeyExecutives',
  path: '/management',
  description: 'Get executive management team data for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'KeyExecutives', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'ExecutiveCompensation',
  path: '/management_compensation',
  description: 'Get executive management team compensation for a given company over time.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ExecutiveCompensation', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'FinancialRatios',
  path: '/ratios',
  description: 'Get an extensive set of financial and accounting ratios for a given company over time.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'FinancialRatios', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'RevenueGeographic',
  path: '/revenue_per_geography',
  description: 'Get the geographic revenue breakdown for a given company over time.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'RevenueGeographic', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'RevenueBusinessLine',
  path: '/revenue_per_segment',
  description: 'Get the revenue breakdown by business segment for a given company over time.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'RevenueBusinessLine', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'CompanyFilings',
  path: '/filings',
  description: 'Get the URLs to SEC filings reported to the EDGAR database.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CompanyFilings', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'HistoricalSplits',
  path: '/historical_splits',
  description: 'Get historical stock splits for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'HistoricalSplits', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'EarningsCallTranscript',
  path: '/transcript',
  description: 'Get earnings call transcripts for a given company.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EarningsCallTranscript', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'TrailingDividendYield',
  path: '/trailing_dividend_yield',
  description: 'Get the 1 year trailing dividend yield for a given company over time.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'TrailingDividendYield', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'ManagementDiscussionAnalysis',
  path: '/management_discussion_analysis',
  description: 'Get the Management Discussion & Analysis section from financial statements.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ManagementDiscussionAnalysis', params, credentials)
  },
})

fundamentalRouter.command({
  model: 'EsgScore',
  path: '/esg_score',
  description: 'Get ESG (Environmental, Social, and Governance) scores from company disclosures.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EsgScore', params, credentials)
  },
})
