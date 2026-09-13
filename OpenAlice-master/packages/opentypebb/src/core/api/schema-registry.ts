/**
 * Schema Registry — maps model names to their standard-model Zod schemas.
 *
 * In Python OpenBB, FastAPI auto-generates OpenAPI from Pydantic models.
 * Here we maintain an explicit registry so buildWidgetsJson() can introspect
 * Zod schemas for query params (→ widget form fields) and data (→ table columns).
 *
 * Models not in this registry will still get basic widget configs, just without
 * detailed param/column definitions.
 */

import type { ZodObject } from 'zod'

import { EquityHistoricalQueryParamsSchema, EquityHistoricalDataSchema } from '../../standard-models/equity-historical.js'
import { EquityInfoQueryParamsSchema, EquityInfoDataSchema } from '../../standard-models/equity-info.js'
import { EquityQuoteQueryParamsSchema, EquityQuoteDataSchema } from '../../standard-models/equity-quote.js'
import { CompanyNewsQueryParamsSchema, CompanyNewsDataSchema } from '../../standard-models/company-news.js'
import { WorldNewsQueryParamsSchema, WorldNewsDataSchema } from '../../standard-models/world-news.js'
import { CryptoHistoricalQueryParamsSchema, CryptoHistoricalDataSchema } from '../../standard-models/crypto-historical.js'
import { CurrencyHistoricalQueryParamsSchema, CurrencyHistoricalDataSchema } from '../../standard-models/currency-historical.js'
import { BalanceSheetQueryParamsSchema, BalanceSheetDataSchema } from '../../standard-models/balance-sheet.js'
import { IncomeStatementQueryParamsSchema, IncomeStatementDataSchema } from '../../standard-models/income-statement.js'
import { CashFlowStatementQueryParamsSchema, CashFlowStatementDataSchema } from '../../standard-models/cash-flow.js'
import { FinancialRatiosQueryParamsSchema, FinancialRatiosDataSchema } from '../../standard-models/financial-ratios.js'
import { KeyMetricsQueryParamsSchema, KeyMetricsDataSchema } from '../../standard-models/key-metrics.js'
import { InsiderTradingQueryParamsSchema, InsiderTradingDataSchema } from '../../standard-models/insider-trading.js'
import { CalendarEarningsQueryParamsSchema, CalendarEarningsDataSchema } from '../../standard-models/calendar-earnings.js'
import { EquityDiscoveryQueryParamsSchema, EquityDiscoveryDataSchema } from '../../standard-models/equity-discovery.js'
import { PriceTargetConsensusQueryParamsSchema, PriceTargetConsensusDataSchema } from '../../standard-models/price-target-consensus.js'
import { CryptoSearchQueryParamsSchema, CryptoSearchDataSchema } from '../../standard-models/crypto-search.js'
import { CurrencyPairsQueryParamsSchema, CurrencyPairsDataSchema } from '../../standard-models/currency-pairs.js'
import { EquityPerformanceQueryParamsSchema, EquityPerformanceDataSchema } from '../../standard-models/equity-performance.js'
import { BalanceSheetGrowthQueryParamsSchema, BalanceSheetGrowthDataSchema } from '../../standard-models/balance-sheet-growth.js'
import { IncomeStatementGrowthQueryParamsSchema, IncomeStatementGrowthDataSchema } from '../../standard-models/income-statement-growth.js'
import { CashFlowStatementGrowthQueryParamsSchema, CashFlowStatementGrowthDataSchema } from '../../standard-models/cash-flow-growth.js'
import { CalendarDividendQueryParamsSchema, CalendarDividendDataSchema } from '../../standard-models/calendar-dividend.js'
import { CalendarSplitsQueryParamsSchema, CalendarSplitsDataSchema } from '../../standard-models/calendar-splits.js'
import { CalendarIpoQueryParamsSchema, CalendarIpoDataSchema } from '../../standard-models/calendar-ipo.js'
import { EconomicCalendarQueryParamsSchema, EconomicCalendarDataSchema } from '../../standard-models/economic-calendar.js'
import { AnalystEstimatesQueryParamsSchema, AnalystEstimatesDataSchema } from '../../standard-models/analyst-estimates.js'
import { ForwardEpsEstimatesQueryParamsSchema, ForwardEpsEstimatesDataSchema } from '../../standard-models/forward-eps-estimates.js'
import { ForwardEbitdaEstimatesQueryParamsSchema, ForwardEbitdaEstimatesDataSchema } from '../../standard-models/forward-ebitda-estimates.js'
import { PriceTargetQueryParamsSchema, PriceTargetDataSchema } from '../../standard-models/price-target.js'
import { EtfInfoQueryParamsSchema, EtfInfoDataSchema } from '../../standard-models/etf-info.js'
import { EtfHoldingsQueryParamsSchema, EtfHoldingsDataSchema } from '../../standard-models/etf-holdings.js'
import { EtfSectorsQueryParamsSchema, EtfSectorsDataSchema } from '../../standard-models/etf-sectors.js'
import { EtfCountriesQueryParamsSchema, EtfCountriesDataSchema } from '../../standard-models/etf-countries.js'
import { EtfEquityExposureQueryParamsSchema, EtfEquityExposureDataSchema } from '../../standard-models/etf-equity-exposure.js'
import { EtfSearchQueryParamsSchema, EtfSearchDataSchema } from '../../standard-models/etf-search.js'
import { KeyExecutivesQueryParamsSchema, KeyExecutivesDataSchema } from '../../standard-models/key-executives.js'
import { ExecutiveCompensationQueryParamsSchema, ExecutiveCompensationDataSchema } from '../../standard-models/executive-compensation.js'
import { GovernmentTradesQueryParamsSchema, GovernmentTradesDataSchema } from '../../standard-models/government-trades.js'
import { InstitutionalOwnershipQueryParamsSchema, InstitutionalOwnershipDataSchema } from '../../standard-models/institutional-ownership.js'
import { HistoricalDividendsQueryParamsSchema, HistoricalDividendsDataSchema } from '../../standard-models/historical-dividends.js'
import { HistoricalSplitsQueryParamsSchema, HistoricalSplitsDataSchema } from '../../standard-models/historical-splits.js'
import { HistoricalEpsQueryParamsSchema, HistoricalEpsDataSchema } from '../../standard-models/historical-eps.js'
import { HistoricalEmployeesQueryParamsSchema, HistoricalEmployeesDataSchema } from '../../standard-models/historical-employees.js'
import { ShareStatisticsQueryParamsSchema, ShareStatisticsDataSchema } from '../../standard-models/share-statistics.js'
import { EquityPeersQueryParamsSchema, EquityPeersDataSchema } from '../../standard-models/equity-peers.js'
import { EquityScreenerQueryParamsSchema, EquityScreenerDataSchema } from '../../standard-models/equity-screener.js'
import { CompanyFilingsQueryParamsSchema, CompanyFilingsDataSchema } from '../../standard-models/company-filings.js'
import { MarketSnapshotsQueryParamsSchema, MarketSnapshotsDataSchema } from '../../standard-models/market-snapshots.js'
import { CurrencySnapshotsQueryParamsSchema, CurrencySnapshotsDataSchema } from '../../standard-models/currency-snapshots.js'
import { AvailableIndicesQueryParamsSchema, AvailableIndicesDataSchema } from '../../standard-models/available-indices.js'
import { IndexConstituentsQueryParamsSchema, IndexConstituentsDataSchema } from '../../standard-models/index-constituents.js'
import { IndexHistoricalQueryParamsSchema, IndexHistoricalDataSchema } from '../../standard-models/index-historical.js'
import { RiskPremiumQueryParamsSchema, RiskPremiumDataSchema } from '../../standard-models/risk-premium.js'
import { TreasuryRatesQueryParamsSchema, TreasuryRatesDataSchema } from '../../standard-models/treasury-rates.js'
import { RevenueBusinessLineQueryParamsSchema, RevenueBusinessLineDataSchema } from '../../standard-models/revenue-business-line.js'
import { RevenueGeographicQueryParamsSchema, RevenueGeographicDataSchema } from '../../standard-models/revenue-geographic.js'
import { EarningsCallTranscriptQueryParamsSchema, EarningsCallTranscriptDataSchema } from '../../standard-models/earnings-call-transcript.js'
import { DiscoveryFilingsQueryParamsSchema, DiscoveryFilingsDataSchema } from '../../standard-models/discovery-filings.js'
import { HistoricalMarketCapQueryParamsSchema, HistoricalMarketCapDataSchema } from '../../standard-models/historical-market-cap.js'
import { EsgScoreQueryParamsSchema, EsgScoreDataSchema } from '../../standard-models/esg-score.js'
import { FuturesHistoricalQueryParamsSchema, FuturesHistoricalDataSchema } from '../../standard-models/futures-historical.js'
import { FuturesCurveQueryParamsSchema, FuturesCurveDataSchema } from '../../standard-models/futures-curve.js'
import { FuturesInfoQueryParamsSchema, FuturesInfoDataSchema } from '../../standard-models/futures-info.js'
import { FuturesInstrumentsQueryParamsSchema, FuturesInstrumentsDataSchema } from '../../standard-models/futures-instruments.js'
import { OptionsChainsQueryParamsSchema, OptionsChainsDataSchema } from '../../standard-models/options-chains.js'
import { OptionsSnapshotsQueryParamsSchema, OptionsSnapshotsDataSchema } from '../../standard-models/options-snapshots.js'
import { OptionsUnusualQueryParamsSchema, OptionsUnusualDataSchema } from '../../standard-models/options-unusual.js'
import { IndexSearchQueryParamsSchema, IndexSearchDataSchema } from '../../standard-models/index-search.js'
import { IndexSectorsQueryParamsSchema, IndexSectorsDataSchema } from '../../standard-models/index-sectors.js'
import { SP500MultiplesQueryParamsSchema, SP500MultiplesDataSchema } from '../../standard-models/sp500-multiples.js'
import { AvailableIndicatorsQueryParamsSchema, AvailableIndicatorsDataSchema } from '../../standard-models/available-indicators.js'
import { ConsumerPriceIndexQueryParamsSchema, ConsumerPriceIndexDataSchema } from '../../standard-models/consumer-price-index.js'
import { CompositeLeadingIndicatorQueryParamsSchema, CompositeLeadingIndicatorDataSchema } from '../../standard-models/composite-leading-indicator.js'
import { CountryInterestRatesQueryParamsSchema, CountryInterestRatesDataSchema } from '../../standard-models/country-interest-rates.js'
import { BalanceOfPaymentsQueryParamsSchema, BalanceOfPaymentsDataSchema } from '../../standard-models/balance-of-payments.js'
import { CentralBankHoldingsQueryParamsSchema, CentralBankHoldingsDataSchema } from '../../standard-models/central-bank-holdings.js'
import { CountryProfileQueryParamsSchema, CountryProfileDataSchema } from '../../standard-models/country-profile.js'
import { DirectionOfTradeQueryParamsSchema, DirectionOfTradeDataSchema } from '../../standard-models/direction-of-trade.js'
import { ExportDestinationsQueryParamsSchema, ExportDestinationsDataSchema } from '../../standard-models/export-destinations.js'
import { EconomicIndicatorsQueryParamsSchema, EconomicIndicatorsDataSchema } from '../../standard-models/economic-indicators.js'
import { FredSearchQueryParamsSchema, FredSearchDataSchema } from '../../standard-models/fred-search.js'
import { FredSeriesQueryParamsSchema, FredSeriesDataSchema } from '../../standard-models/fred-series.js'
import { FredReleaseTableQueryParamsSchema, FredReleaseTableDataSchema } from '../../standard-models/fred-release-table.js'
import { FredRegionalQueryParamsSchema, FredRegionalDataSchema } from '../../standard-models/fred-regional.js'
import { UnemploymentQueryParamsSchema, UnemploymentDataSchema } from '../../standard-models/unemployment.js'
import { MoneyMeasuresQueryParamsSchema, MoneyMeasuresDataSchema } from '../../standard-models/money-measures.js'
import { PersonalConsumptionExpendituresQueryParamsSchema, PersonalConsumptionExpendituresDataSchema } from '../../standard-models/pce.js'
import { TotalFactorProductivityQueryParamsSchema, TotalFactorProductivityDataSchema } from '../../standard-models/total-factor-productivity.js'
import { FomcDocumentsQueryParamsSchema, FomcDocumentsDataSchema } from '../../standard-models/fomc-documents.js'
import { PrimaryDealerPositioningQueryParamsSchema, PrimaryDealerPositioningDataSchema } from '../../standard-models/primary-dealer-positioning.js'
import { PrimaryDealerFailsQueryParamsSchema, PrimaryDealerFailsDataSchema } from '../../standard-models/primary-dealer-fails.js'
import { NonfarmPayrollsQueryParamsSchema, NonfarmPayrollsDataSchema } from '../../standard-models/nonfarm-payrolls.js'
import { InflationExpectationsQueryParamsSchema, InflationExpectationsDataSchema } from '../../standard-models/inflation-expectations.js'
import { SloosQueryParamsSchema, SloosDataSchema } from '../../standard-models/sloos.js'
import { UniversityOfMichiganQueryParamsSchema, UniversityOfMichiganDataSchema } from '../../standard-models/university-of-michigan.js'
import { EconomicConditionsChicagoQueryParamsSchema, EconomicConditionsChicagoDataSchema } from '../../standard-models/economic-conditions-chicago.js'
import { ManufacturingOutlookNYQueryParamsSchema, ManufacturingOutlookNYDataSchema } from '../../standard-models/manufacturing-outlook-ny.js'
import { ManufacturingOutlookTexasQueryParamsSchema, ManufacturingOutlookTexasDataSchema } from '../../standard-models/manufacturing-outlook-texas.js'
import { GdpForecastQueryParamsSchema, GdpForecastDataSchema } from '../../standard-models/gdp-forecast.js'
import { GdpNominalQueryParamsSchema, GdpNominalDataSchema } from '../../standard-models/gdp-nominal.js'
import { GdpRealQueryParamsSchema, GdpRealDataSchema } from '../../standard-models/gdp-real.js'
import { SharePriceIndexQueryParamsSchema, SharePriceIndexDataSchema } from '../../standard-models/share-price-index.js'
import { HousePriceIndexQueryParamsSchema, HousePriceIndexDataSchema } from '../../standard-models/house-price-index.js'
import { RetailPricesQueryParamsSchema, RetailPricesDataSchema } from '../../standard-models/retail-prices.js'
import { BlsSeriesQueryParamsSchema, BlsSeriesDataSchema } from '../../standard-models/bls-series.js'
import { BlsSearchQueryParamsSchema, BlsSearchDataSchema } from '../../standard-models/bls-search.js'
import { CommoditySpotPriceQueryParamsSchema, CommoditySpotPriceDataSchema } from '../../standard-models/commodity-spot-price.js'
import { PetroleumStatusReportQueryParamsSchema, PetroleumStatusReportDataSchema } from '../../standard-models/petroleum-status-report.js'
import { ShortTermEnergyOutlookQueryParamsSchema, ShortTermEnergyOutlookDataSchema } from '../../standard-models/short-term-energy-outlook.js'
import { PortInfoQueryParamsSchema, PortInfoDataSchema } from '../../standard-models/port-info.js'
import { PortVolumeQueryParamsSchema, PortVolumeDataSchema } from '../../standard-models/port-volume.js'
import { ChokepointInfoQueryParamsSchema, ChokepointInfoDataSchema } from '../../standard-models/chokepoint-info.js'
import { ChokepointVolumeQueryParamsSchema, ChokepointVolumeDataSchema } from '../../standard-models/chokepoint-volume.js'

export interface ModelSchemas {
  queryParams: ZodObject<any>
  data: ZodObject<any>
}

/**
 * Registry mapping model names (as used in Router commands) to their
 * standard-model Zod schemas for query params and response data.
 */
export const SCHEMA_REGISTRY: Record<string, ModelSchemas> = {
  // --- Equity ---
  EquityHistorical:          { queryParams: EquityHistoricalQueryParamsSchema, data: EquityHistoricalDataSchema },
  EquityInfo:                { queryParams: EquityInfoQueryParamsSchema, data: EquityInfoDataSchema },
  EquityQuote:               { queryParams: EquityQuoteQueryParamsSchema, data: EquityQuoteDataSchema },
  EquityScreener:            { queryParams: EquityScreenerQueryParamsSchema, data: EquityScreenerDataSchema },
  EquityPeers:               { queryParams: EquityPeersQueryParamsSchema, data: EquityPeersDataSchema },
  MarketSnapshots:           { queryParams: MarketSnapshotsQueryParamsSchema, data: MarketSnapshotsDataSchema },
  HistoricalMarketCap:       { queryParams: HistoricalMarketCapQueryParamsSchema, data: HistoricalMarketCapDataSchema },
  PricePerformance:          { queryParams: EquityPerformanceQueryParamsSchema, data: EquityPerformanceDataSchema },

  // Equity Discovery (all use the same EquityDiscovery schema)
  EquityGainers:             { queryParams: EquityDiscoveryQueryParamsSchema, data: EquityDiscoveryDataSchema },
  EquityLosers:              { queryParams: EquityDiscoveryQueryParamsSchema, data: EquityDiscoveryDataSchema },
  EquityActive:              { queryParams: EquityDiscoveryQueryParamsSchema, data: EquityDiscoveryDataSchema },

  // Equity Fundamental
  BalanceSheet:              { queryParams: BalanceSheetQueryParamsSchema, data: BalanceSheetDataSchema },
  BalanceSheetGrowth:        { queryParams: BalanceSheetGrowthQueryParamsSchema, data: BalanceSheetGrowthDataSchema },
  IncomeStatement:           { queryParams: IncomeStatementQueryParamsSchema, data: IncomeStatementDataSchema },
  IncomeStatementGrowth:     { queryParams: IncomeStatementGrowthQueryParamsSchema, data: IncomeStatementGrowthDataSchema },
  CashFlowStatement:         { queryParams: CashFlowStatementQueryParamsSchema, data: CashFlowStatementDataSchema },
  CashFlowStatementGrowth:   { queryParams: CashFlowStatementGrowthQueryParamsSchema, data: CashFlowStatementGrowthDataSchema },
  FinancialRatios:           { queryParams: FinancialRatiosQueryParamsSchema, data: FinancialRatiosDataSchema },
  KeyMetrics:                { queryParams: KeyMetricsQueryParamsSchema, data: KeyMetricsDataSchema },
  KeyExecutives:             { queryParams: KeyExecutivesQueryParamsSchema, data: KeyExecutivesDataSchema },
  ExecutiveCompensation:     { queryParams: ExecutiveCompensationQueryParamsSchema, data: ExecutiveCompensationDataSchema },
  HistoricalDividends:       { queryParams: HistoricalDividendsQueryParamsSchema, data: HistoricalDividendsDataSchema },
  HistoricalSplits:          { queryParams: HistoricalSplitsQueryParamsSchema, data: HistoricalSplitsDataSchema },
  HistoricalEps:             { queryParams: HistoricalEpsQueryParamsSchema, data: HistoricalEpsDataSchema },
  HistoricalEmployees:       { queryParams: HistoricalEmployeesQueryParamsSchema, data: HistoricalEmployeesDataSchema },
  CompanyFilings:            { queryParams: CompanyFilingsQueryParamsSchema, data: CompanyFilingsDataSchema },
  RevenueGeographic:         { queryParams: RevenueGeographicQueryParamsSchema, data: RevenueGeographicDataSchema },
  RevenueBusinessLine:       { queryParams: RevenueBusinessLineQueryParamsSchema, data: RevenueBusinessLineDataSchema },
  EarningsCallTranscript:    { queryParams: EarningsCallTranscriptQueryParamsSchema, data: EarningsCallTranscriptDataSchema },
  EsgScore:                  { queryParams: EsgScoreQueryParamsSchema, data: EsgScoreDataSchema },
  ShareStatistics:           { queryParams: ShareStatisticsQueryParamsSchema, data: ShareStatisticsDataSchema },

  // Equity Ownership
  InsiderTrading:            { queryParams: InsiderTradingQueryParamsSchema, data: InsiderTradingDataSchema },
  InstitutionalOwnership:    { queryParams: InstitutionalOwnershipQueryParamsSchema, data: InstitutionalOwnershipDataSchema },
  GovernmentTrades:          { queryParams: GovernmentTradesQueryParamsSchema, data: GovernmentTradesDataSchema },

  // Equity Calendar
  CalendarEarnings:          { queryParams: CalendarEarningsQueryParamsSchema, data: CalendarEarningsDataSchema },
  CalendarDividend:          { queryParams: CalendarDividendQueryParamsSchema, data: CalendarDividendDataSchema },
  CalendarSplits:            { queryParams: CalendarSplitsQueryParamsSchema, data: CalendarSplitsDataSchema },
  CalendarIpo:               { queryParams: CalendarIpoQueryParamsSchema, data: CalendarIpoDataSchema },

  // Equity Estimates
  PriceTarget:               { queryParams: PriceTargetQueryParamsSchema, data: PriceTargetDataSchema },
  PriceTargetConsensus:      { queryParams: PriceTargetConsensusQueryParamsSchema, data: PriceTargetConsensusDataSchema },
  AnalystEstimates:          { queryParams: AnalystEstimatesQueryParamsSchema, data: AnalystEstimatesDataSchema },
  ForwardEpsEstimates:       { queryParams: ForwardEpsEstimatesQueryParamsSchema, data: ForwardEpsEstimatesDataSchema },
  ForwardEbitdaEstimates:    { queryParams: ForwardEbitdaEstimatesQueryParamsSchema, data: ForwardEbitdaEstimatesDataSchema },

  // --- News ---
  CompanyNews:               { queryParams: CompanyNewsQueryParamsSchema, data: CompanyNewsDataSchema },
  WorldNews:                 { queryParams: WorldNewsQueryParamsSchema, data: WorldNewsDataSchema },

  // --- Crypto ---
  CryptoHistorical:          { queryParams: CryptoHistoricalQueryParamsSchema, data: CryptoHistoricalDataSchema },
  CryptoSearch:              { queryParams: CryptoSearchQueryParamsSchema, data: CryptoSearchDataSchema },

  // --- Currency ---
  CurrencyHistorical:        { queryParams: CurrencyHistoricalQueryParamsSchema, data: CurrencyHistoricalDataSchema },
  CurrencyPairs:             { queryParams: CurrencyPairsQueryParamsSchema, data: CurrencyPairsDataSchema },
  CurrencySnapshots:         { queryParams: CurrencySnapshotsQueryParamsSchema, data: CurrencySnapshotsDataSchema },

  // --- ETF ---
  EtfInfo:                   { queryParams: EtfInfoQueryParamsSchema, data: EtfInfoDataSchema },
  EtfHoldings:               { queryParams: EtfHoldingsQueryParamsSchema, data: EtfHoldingsDataSchema },
  EtfSectors:                { queryParams: EtfSectorsQueryParamsSchema, data: EtfSectorsDataSchema },
  EtfCountries:              { queryParams: EtfCountriesQueryParamsSchema, data: EtfCountriesDataSchema },
  EtfEquityExposure:         { queryParams: EtfEquityExposureQueryParamsSchema, data: EtfEquityExposureDataSchema },
  EtfSearch:                 { queryParams: EtfSearchQueryParamsSchema, data: EtfSearchDataSchema },
  EtfHistorical:             { queryParams: EquityHistoricalQueryParamsSchema, data: EquityHistoricalDataSchema },

  // --- Index ---
  AvailableIndices:          { queryParams: AvailableIndicesQueryParamsSchema, data: AvailableIndicesDataSchema },
  IndexConstituents:         { queryParams: IndexConstituentsQueryParamsSchema, data: IndexConstituentsDataSchema },
  IndexHistorical:           { queryParams: IndexHistoricalQueryParamsSchema, data: IndexHistoricalDataSchema },
  RiskPremium:               { queryParams: RiskPremiumQueryParamsSchema, data: RiskPremiumDataSchema },
  IndexSearch:               { queryParams: IndexSearchQueryParamsSchema, data: IndexSearchDataSchema },
  IndexSectors:              { queryParams: IndexSectorsQueryParamsSchema, data: IndexSectorsDataSchema },
  SP500Multiples:            { queryParams: SP500MultiplesQueryParamsSchema, data: SP500MultiplesDataSchema },

  // --- Derivatives ---
  FuturesHistorical:         { queryParams: FuturesHistoricalQueryParamsSchema, data: FuturesHistoricalDataSchema },
  FuturesCurve:              { queryParams: FuturesCurveQueryParamsSchema, data: FuturesCurveDataSchema },
  FuturesInfo:               { queryParams: FuturesInfoQueryParamsSchema, data: FuturesInfoDataSchema },
  FuturesInstruments:        { queryParams: FuturesInstrumentsQueryParamsSchema, data: FuturesInstrumentsDataSchema },
  OptionsChains:             { queryParams: OptionsChainsQueryParamsSchema, data: OptionsChainsDataSchema },
  OptionsSnapshots:          { queryParams: OptionsSnapshotsQueryParamsSchema, data: OptionsSnapshotsDataSchema },
  OptionsUnusual:            { queryParams: OptionsUnusualQueryParamsSchema, data: OptionsUnusualDataSchema },

  // --- Economy ---
  EconomicCalendar:          { queryParams: EconomicCalendarQueryParamsSchema, data: EconomicCalendarDataSchema },
  TreasuryRates:             { queryParams: TreasuryRatesQueryParamsSchema, data: TreasuryRatesDataSchema },
  DiscoveryFilings:          { queryParams: DiscoveryFilingsQueryParamsSchema, data: DiscoveryFilingsDataSchema },
  AvailableIndicators:       { queryParams: AvailableIndicatorsQueryParamsSchema, data: AvailableIndicatorsDataSchema },
  ConsumerPriceIndex:        { queryParams: ConsumerPriceIndexQueryParamsSchema, data: ConsumerPriceIndexDataSchema },
  CompositeLeadingIndicator: { queryParams: CompositeLeadingIndicatorQueryParamsSchema, data: CompositeLeadingIndicatorDataSchema },
  CountryInterestRates:      { queryParams: CountryInterestRatesQueryParamsSchema, data: CountryInterestRatesDataSchema },
  BalanceOfPayments:         { queryParams: BalanceOfPaymentsQueryParamsSchema, data: BalanceOfPaymentsDataSchema },
  CentralBankHoldings:       { queryParams: CentralBankHoldingsQueryParamsSchema, data: CentralBankHoldingsDataSchema },
  CountryProfile:            { queryParams: CountryProfileQueryParamsSchema, data: CountryProfileDataSchema },
  DirectionOfTrade:          { queryParams: DirectionOfTradeQueryParamsSchema, data: DirectionOfTradeDataSchema },
  ExportDestinations:        { queryParams: ExportDestinationsQueryParamsSchema, data: ExportDestinationsDataSchema },
  EconomicIndicators:        { queryParams: EconomicIndicatorsQueryParamsSchema, data: EconomicIndicatorsDataSchema },

  // Economy — FRED
  FredSearch:                { queryParams: FredSearchQueryParamsSchema, data: FredSearchDataSchema },
  FredSeries:                { queryParams: FredSeriesQueryParamsSchema, data: FredSeriesDataSchema },
  FredReleaseTable:          { queryParams: FredReleaseTableQueryParamsSchema, data: FredReleaseTableDataSchema },
  FredRegional:              { queryParams: FredRegionalQueryParamsSchema, data: FredRegionalDataSchema },

  // Economy — Macro
  Unemployment:              { queryParams: UnemploymentQueryParamsSchema, data: UnemploymentDataSchema },
  MoneyMeasures:             { queryParams: MoneyMeasuresQueryParamsSchema, data: MoneyMeasuresDataSchema },
  PersonalConsumptionExpenditures: { queryParams: PersonalConsumptionExpendituresQueryParamsSchema, data: PersonalConsumptionExpendituresDataSchema },
  TotalFactorProductivity:   { queryParams: TotalFactorProductivityQueryParamsSchema, data: TotalFactorProductivityDataSchema },
  FomcDocuments:             { queryParams: FomcDocumentsQueryParamsSchema, data: FomcDocumentsDataSchema },
  PrimaryDealerPositioning:  { queryParams: PrimaryDealerPositioningQueryParamsSchema, data: PrimaryDealerPositioningDataSchema },
  PrimaryDealerFails:        { queryParams: PrimaryDealerFailsQueryParamsSchema, data: PrimaryDealerFailsDataSchema },

  // Economy — Survey
  NonfarmPayrolls:           { queryParams: NonfarmPayrollsQueryParamsSchema, data: NonfarmPayrollsDataSchema },
  InflationExpectations:     { queryParams: InflationExpectationsQueryParamsSchema, data: InflationExpectationsDataSchema },
  Sloos:                     { queryParams: SloosQueryParamsSchema, data: SloosDataSchema },
  UniversityOfMichigan:      { queryParams: UniversityOfMichiganQueryParamsSchema, data: UniversityOfMichiganDataSchema },
  EconomicConditionsChicago: { queryParams: EconomicConditionsChicagoQueryParamsSchema, data: EconomicConditionsChicagoDataSchema },
  ManufacturingOutlookTexas: { queryParams: ManufacturingOutlookTexasQueryParamsSchema, data: ManufacturingOutlookTexasDataSchema },
  ManufacturingOutlookNY:    { queryParams: ManufacturingOutlookNYQueryParamsSchema, data: ManufacturingOutlookNYDataSchema },
  BlsSeries:                 { queryParams: BlsSeriesQueryParamsSchema, data: BlsSeriesDataSchema },
  BlsSearch:                 { queryParams: BlsSearchQueryParamsSchema, data: BlsSearchDataSchema },

  // Economy — GDP
  GdpForecast:               { queryParams: GdpForecastQueryParamsSchema, data: GdpForecastDataSchema },
  GdpNominal:                { queryParams: GdpNominalQueryParamsSchema, data: GdpNominalDataSchema },
  GdpReal:                   { queryParams: GdpRealQueryParamsSchema, data: GdpRealDataSchema },

  // Economy — OECD
  SharePriceIndex:           { queryParams: SharePriceIndexQueryParamsSchema, data: SharePriceIndexDataSchema },
  HousePriceIndex:           { queryParams: HousePriceIndexQueryParamsSchema, data: HousePriceIndexDataSchema },
  RetailPrices:              { queryParams: RetailPricesQueryParamsSchema, data: RetailPricesDataSchema },

  // --- Commodity ---
  CommoditySpotPrice:        { queryParams: CommoditySpotPriceQueryParamsSchema, data: CommoditySpotPriceDataSchema },
  PetroleumStatusReport:     { queryParams: PetroleumStatusReportQueryParamsSchema, data: PetroleumStatusReportDataSchema },
  ShortTermEnergyOutlook:    { queryParams: ShortTermEnergyOutlookQueryParamsSchema, data: ShortTermEnergyOutlookDataSchema },

  // --- Shipping ---
  PortInfo:                  { queryParams: PortInfoQueryParamsSchema, data: PortInfoDataSchema },
  PortVolume:                { queryParams: PortVolumeQueryParamsSchema, data: PortVolumeDataSchema },
  ChokepointInfo:            { queryParams: ChokepointInfoQueryParamsSchema, data: ChokepointInfoDataSchema },
  ChokepointVolume:          { queryParams: ChokepointVolumeQueryParamsSchema, data: ChokepointVolumeDataSchema },
}
