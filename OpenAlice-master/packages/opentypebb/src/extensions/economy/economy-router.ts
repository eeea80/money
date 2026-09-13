/**
 * Economy Router.
 * Maps to: openbb_economy/economy_router.py
 */

import { Router } from '../../core/app/router.js'
import { surveyRouter } from './survey/survey-router.js'
import { gdpRouter } from './gdp/gdp-router.js'
import { shippingRouter } from './shipping/shipping-router.js'

export const economyRouter = new Router({
  prefix: '/economy',
  description: 'Economic data.',
})

// --- Include sub-routers ---
economyRouter.includeRouter(surveyRouter)
economyRouter.includeRouter(gdpRouter)
economyRouter.includeRouter(shippingRouter)

// --- Root-level commands ---

economyRouter.command({
  model: 'EconomicCalendar',
  path: '/calendar',
  description: 'Get the upcoming and historical economic calendar events.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EconomicCalendar', params, credentials)
  },
})

economyRouter.command({
  model: 'TreasuryRates',
  path: '/treasury_rates',
  description: 'Get current and historical Treasury rates.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'TreasuryRates', params, credentials)
  },
})

economyRouter.command({
  model: 'DiscoveryFilings',
  path: '/discovery_filings',
  description: 'Search and discover SEC filings by form type and date range.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'DiscoveryFilings', params, credentials)
  },
})

economyRouter.command({
  model: 'AvailableIndicators',
  path: '/available_indicators',
  description: 'Get the list of available economic indicators.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'AvailableIndicators', params, credentials)
  },
})

economyRouter.command({
  model: 'ConsumerPriceIndex',
  path: '/cpi',
  description: 'Get Consumer Price Index (CPI) data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ConsumerPriceIndex', params, credentials)
  },
})

economyRouter.command({
  model: 'CompositeLeadingIndicator',
  path: '/composite_leading_indicator',
  description: 'Get Composite Leading Indicator (CLI) data from the OECD.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CompositeLeadingIndicator', params, credentials)
  },
})

economyRouter.command({
  model: 'CountryInterestRates',
  path: '/interest_rates',
  description: 'Get short-term interest rates by country.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CountryInterestRates', params, credentials)
  },
})

economyRouter.command({
  model: 'BalanceOfPayments',
  path: '/balance_of_payments',
  description: 'Get balance of payments data from the ECB.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'BalanceOfPayments', params, credentials)
  },
})

economyRouter.command({
  model: 'CentralBankHoldings',
  path: '/central_bank_holdings',
  description: 'Get central bank holdings data (Fed balance sheet).',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CentralBankHoldings', params, credentials)
  },
})

economyRouter.command({
  model: 'CountryProfile',
  path: '/country_profile',
  description: 'Get a comprehensive economic profile for a country.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'CountryProfile', params, credentials)
  },
})

economyRouter.command({
  model: 'DirectionOfTrade',
  path: '/direction_of_trade',
  description: 'Get direction of trade statistics from the IMF.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'DirectionOfTrade', params, credentials)
  },
})

economyRouter.command({
  model: 'ExportDestinations',
  path: '/export_destinations',
  description: 'Get top export destinations for a country.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'ExportDestinations', params, credentials)
  },
})

economyRouter.command({
  model: 'EconomicIndicators',
  path: '/indicators',
  description: 'Get economic indicator time series data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'EconomicIndicators', params, credentials)
  },
})

economyRouter.command({
  model: 'RiskPremium',
  path: '/risk_premium',
  description: 'Get market risk premium by country.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'RiskPremium', params, credentials)
  },
})

// --- FRED endpoints ---

economyRouter.command({
  model: 'FredSearch',
  path: '/fred_search',
  description: 'Search FRED economic data series.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'FredSearch', params, credentials)
  },
})

economyRouter.command({
  model: 'FredSeries',
  path: '/fred_series',
  description: 'Get FRED series observations.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'FredSeries', params, credentials)
  },
})

economyRouter.command({
  model: 'FredReleaseTable',
  path: '/fred_release_table',
  description: 'Get FRED release table data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'FredReleaseTable', params, credentials)
  },
})

economyRouter.command({
  model: 'FredRegional',
  path: '/fred_regional',
  description: 'Get FRED regional (GeoFRED) data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'FredRegional', params, credentials)
  },
})

// --- Macro indicators ---

economyRouter.command({
  model: 'Unemployment',
  path: '/unemployment',
  description: 'Get unemployment rate data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'Unemployment', params, credentials)
  },
})

economyRouter.command({
  model: 'MoneyMeasures',
  path: '/money_measures',
  description: 'Get money supply measures (M1, M2).',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'MoneyMeasures', params, credentials)
  },
})

economyRouter.command({
  model: 'PersonalConsumptionExpenditures',
  path: '/pce',
  description: 'Get Personal Consumption Expenditures (PCE) price index.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'PersonalConsumptionExpenditures', params, credentials)
  },
})

economyRouter.command({
  model: 'TotalFactorProductivity',
  path: '/total_factor_productivity',
  description: 'Get total factor productivity data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'TotalFactorProductivity', params, credentials)
  },
})

economyRouter.command({
  model: 'FomcDocuments',
  path: '/fomc_documents',
  description: 'Get FOMC meeting documents and rate decisions.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'FomcDocuments', params, credentials)
  },
})

economyRouter.command({
  model: 'PrimaryDealerPositioning',
  path: '/primary_dealer_positioning',
  description: 'Get primary dealer positioning data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'PrimaryDealerPositioning', params, credentials)
  },
})

economyRouter.command({
  model: 'PrimaryDealerFails',
  path: '/primary_dealer_fails',
  description: 'Get primary dealer fails-to-deliver data.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'PrimaryDealerFails', params, credentials)
  },
})

// --- OECD endpoints ---

economyRouter.command({
  model: 'SharePriceIndex',
  path: '/share_price_index',
  description: 'Get share price index data from OECD.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'SharePriceIndex', params, credentials)
  },
})

economyRouter.command({
  model: 'HousePriceIndex',
  path: '/house_price_index',
  description: 'Get house price index data from OECD.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'HousePriceIndex', params, credentials)
  },
})

economyRouter.command({
  model: 'RetailPrices',
  path: '/retail_prices',
  description: 'Get retail price data from OECD.',
  handler: async (executor, provider, params, credentials) => {
    return executor.execute(provider, 'RetailPrices', params, credentials)
  },
})
