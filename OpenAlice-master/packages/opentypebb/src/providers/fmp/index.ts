/**
 * FMP Provider Module.
 * Maps to: openbb_platform/providers/fmp/openbb_fmp/__init__.py
 *
 * Only includes fetchers that have been ported to TypeScript.
 * The Python version has ~70 fetchers; we port only what open-alice uses.
 */

import { Provider } from '../../core/provider/abstract/provider.js'

import { FMPEquityProfileFetcher } from './models/equity-profile.js'
import { FMPEquityQuoteFetcher } from './models/equity-quote.js'
import { FMPEquityHistoricalFetcher } from './models/equity-historical.js'
import { FMPBalanceSheetFetcher } from './models/balance-sheet.js'
import { FMPIncomeStatementFetcher } from './models/income-statement.js'
import { FMPCashFlowStatementFetcher } from './models/cash-flow.js'
import { FMPFinancialRatiosFetcher } from './models/financial-ratios.js'
import { FMPKeyMetricsFetcher } from './models/key-metrics.js'
import { FMPInsiderTradingFetcher } from './models/insider-trading.js'
import { FMPCalendarEarningsFetcher } from './models/calendar-earnings.js'
import { FMPCompanyNewsFetcher } from './models/company-news.js'
import { FMPWorldNewsFetcher } from './models/world-news.js'
import { FMPPriceTargetConsensusFetcher } from './models/price-target-consensus.js'
import { FMPGainersFetcher } from './models/gainers.js'
import { FMPLosersFetcher } from './models/losers.js'
import { FMPEquityActiveFetcher } from './models/active.js'
import { FMPCryptoHistoricalFetcher } from './models/crypto-historical.js'
import { FMPCryptoSearchFetcher } from './models/crypto-search.js'
import { FMPCurrencyHistoricalFetcher } from './models/currency-historical.js'
import { FMPCurrencyPairsFetcher } from './models/currency-pairs.js'
import { FMPBalanceSheetGrowthFetcher } from './models/balance-sheet-growth.js'
import { FMPIncomeStatementGrowthFetcher } from './models/income-statement-growth.js'
import { FMPCashFlowStatementGrowthFetcher } from './models/cash-flow-growth.js'
import { FMPCalendarDividendFetcher } from './models/calendar-dividend.js'
import { FMPCalendarSplitsFetcher } from './models/calendar-splits.js'
import { FMPCalendarIpoFetcher } from './models/calendar-ipo.js'
import { FMPEconomicCalendarFetcher } from './models/economic-calendar.js'
import { FMPAnalystEstimatesFetcher } from './models/analyst-estimates.js'
import { FMPForwardEpsEstimatesFetcher } from './models/forward-eps-estimates.js'
import { FMPForwardEbitdaEstimatesFetcher } from './models/forward-ebitda-estimates.js'
import { FMPPriceTargetFetcher } from './models/price-target.js'
import { FMPEtfInfoFetcher } from './models/etf-info.js'
import { FMPEtfHoldingsFetcher } from './models/etf-holdings.js'
import { FMPEtfSectorsFetcher } from './models/etf-sectors.js'
import { FMPEtfCountriesFetcher } from './models/etf-countries.js'
import { FMPEtfEquityExposureFetcher } from './models/etf-equity-exposure.js'
import { FMPEtfSearchFetcher } from './models/etf-search.js'
import { FMPKeyExecutivesFetcher } from './models/key-executives.js'
import { FMPExecutiveCompensationFetcher } from './models/executive-compensation.js'
import { FMPGovernmentTradesFetcher } from './models/government-trades.js'
import { FMPInstitutionalOwnershipFetcher } from './models/institutional-ownership.js'
import { FMPHistoricalDividendsFetcher } from './models/historical-dividends.js'
import { FMPHistoricalSplitsFetcher } from './models/historical-splits.js'
import { FMPHistoricalEpsFetcher } from './models/historical-eps.js'
import { FMPHistoricalEmployeesFetcher } from './models/historical-employees.js'
import { FMPShareStatisticsFetcher } from './models/share-statistics.js'
import { FMPEquityPeersFetcher } from './models/equity-peers.js'
import { FMPEquityScreenerFetcher } from './models/equity-screener.js'
import { FMPCompanyFilingsFetcher } from './models/company-filings.js'
import { FMPPricePerformanceFetcher } from './models/price-performance.js'
import { FMPMarketSnapshotsFetcher } from './models/market-snapshots.js'
import { FMPCurrencySnapshotsFetcher } from './models/currency-snapshots.js'
import { FMPAvailableIndicesFetcher } from './models/available-indices.js'
import { FMPIndexConstituentsFetcher } from './models/index-constituents.js'
import { FMPIndexHistoricalFetcher } from './models/index-historical.js'
import { FMPRiskPremiumFetcher } from './models/risk-premium.js'
import { FMPTreasuryRatesFetcher } from './models/treasury-rates.js'
import { FMPRevenueBusinessLineFetcher } from './models/revenue-business-line.js'
import { FMPRevenueGeographicFetcher } from './models/revenue-geographic.js'
import { FMPEarningsCallTranscriptFetcher } from './models/earnings-call-transcript.js'
import { FMPDiscoveryFilingsFetcher } from './models/discovery-filings.js'
import { FMPEsgScoreFetcher } from './models/esg-score.js'
import { FMPHistoricalMarketCapFetcher } from './models/historical-market-cap.js'
import { FMPEquitySearchFetcher } from './models/equity-search.js'
import { FMPCommoditySpotPriceFetcher } from './models/commodity-spot-price.js'

export const fmpProvider = new Provider({
  name: 'fmp',
  website: 'https://financialmodelingprep.com',
  description:
    'Financial Modeling Prep is a new concept that informs you about ' +
    'stock market information (news, currencies, and stock prices).',
  credentials: ['api_key'],
  reprName: 'Financial Modeling Prep (FMP)',
  fetcherDict: {
    EquityInfo: FMPEquityProfileFetcher,
    EquityQuote: FMPEquityQuoteFetcher,
    EquityHistorical: FMPEquityHistoricalFetcher,
    BalanceSheet: FMPBalanceSheetFetcher,
    IncomeStatement: FMPIncomeStatementFetcher,
    CashFlowStatement: FMPCashFlowStatementFetcher,
    FinancialRatios: FMPFinancialRatiosFetcher,
    KeyMetrics: FMPKeyMetricsFetcher,
    InsiderTrading: FMPInsiderTradingFetcher,
    CalendarEarnings: FMPCalendarEarningsFetcher,
    CompanyNews: FMPCompanyNewsFetcher,
    WorldNews: FMPWorldNewsFetcher,
    PriceTargetConsensus: FMPPriceTargetConsensusFetcher,
    EquityGainers: FMPGainersFetcher,
    EquityLosers: FMPLosersFetcher,
    EquityActive: FMPEquityActiveFetcher,
    CryptoHistorical: FMPCryptoHistoricalFetcher,
    CryptoSearch: FMPCryptoSearchFetcher,
    CurrencyHistorical: FMPCurrencyHistoricalFetcher,
    CurrencyPairs: FMPCurrencyPairsFetcher,
    BalanceSheetGrowth: FMPBalanceSheetGrowthFetcher,
    IncomeStatementGrowth: FMPIncomeStatementGrowthFetcher,
    CashFlowStatementGrowth: FMPCashFlowStatementGrowthFetcher,
    CalendarDividend: FMPCalendarDividendFetcher,
    CalendarSplits: FMPCalendarSplitsFetcher,
    CalendarIpo: FMPCalendarIpoFetcher,
    EconomicCalendar: FMPEconomicCalendarFetcher,
    AnalystEstimates: FMPAnalystEstimatesFetcher,
    ForwardEpsEstimates: FMPForwardEpsEstimatesFetcher,
    ForwardEbitdaEstimates: FMPForwardEbitdaEstimatesFetcher,
    PriceTarget: FMPPriceTargetFetcher,
    EtfInfo: FMPEtfInfoFetcher,
    EtfHoldings: FMPEtfHoldingsFetcher,
    EtfSectors: FMPEtfSectorsFetcher,
    EtfCountries: FMPEtfCountriesFetcher,
    EtfEquityExposure: FMPEtfEquityExposureFetcher,
    EtfSearch: FMPEtfSearchFetcher,
    KeyExecutives: FMPKeyExecutivesFetcher,
    ExecutiveCompensation: FMPExecutiveCompensationFetcher,
    GovernmentTrades: FMPGovernmentTradesFetcher,
    InstitutionalOwnership: FMPInstitutionalOwnershipFetcher,
    // EtfHistorical reuses the same fetcher as EquityHistorical (same pattern as Python)
    EtfHistorical: FMPEquityHistoricalFetcher,
    HistoricalDividends: FMPHistoricalDividendsFetcher,
    HistoricalSplits: FMPHistoricalSplitsFetcher,
    HistoricalEps: FMPHistoricalEpsFetcher,
    HistoricalEmployees: FMPHistoricalEmployeesFetcher,
    ShareStatistics: FMPShareStatisticsFetcher,
    EquityPeers: FMPEquityPeersFetcher,
    EquitySearch: FMPEquitySearchFetcher,
    EquityScreener: FMPEquityScreenerFetcher,
    CompanyFilings: FMPCompanyFilingsFetcher,
    PricePerformance: FMPPricePerformanceFetcher,
    MarketSnapshots: FMPMarketSnapshotsFetcher,
    CurrencySnapshots: FMPCurrencySnapshotsFetcher,
    AvailableIndices: FMPAvailableIndicesFetcher,
    IndexConstituents: FMPIndexConstituentsFetcher,
    IndexHistorical: FMPIndexHistoricalFetcher,
    RiskPremium: FMPRiskPremiumFetcher,
    TreasuryRates: FMPTreasuryRatesFetcher,
    RevenueBusinessLine: FMPRevenueBusinessLineFetcher,
    RevenueGeographic: FMPRevenueGeographicFetcher,
    EarningsCallTranscript: FMPEarningsCallTranscriptFetcher,
    DiscoveryFilings: FMPDiscoveryFilingsFetcher,
    EsgScore: FMPEsgScoreFetcher,
    HistoricalMarketCap: FMPHistoricalMarketCapFetcher,
    CommoditySpotPrice: FMPCommoditySpotPriceFetcher,
  },
})
