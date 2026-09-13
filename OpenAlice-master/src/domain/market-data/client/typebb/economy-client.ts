/**
 * SDK Economy Client
 *
 * Drop-in replacement for OpenBBEconomyClient.
 */

import { SDKBaseClient } from './base-client.js'
import type {
  EconomicCalendarData, ConsumerPriceIndexData, RiskPremiumData, BalanceOfPaymentsData,
  MoneyMeasuresData, UnemploymentData, CompositeLeadingIndicatorData, CountryProfileData,
  AvailableIndicatorsData, EconomicIndicatorsData, CentralBankHoldingsData,
  SharePriceIndexData, HousePriceIndexData, CountryInterestRatesData, RetailPricesData,
  PrimaryDealerPositioningData, PersonalConsumptionExpendituresData,
  ExportDestinationsData, PrimaryDealerFailsData, DirectionOfTradeData,
  FomcDocumentsData, TotalFactorProductivityData,
  FredSearchData, FredSeriesData, FredReleaseTableData, FredRegionalData,
  GdpForecastData, GdpNominalData, GdpRealData,
  BlsSeriesData, BlsSearchData, SloosData, UniversityOfMichiganData,
  EconomicConditionsChicagoData, ManufacturingOutlookTexasData, ManufacturingOutlookNYData,
  NonfarmPayrollsData, InflationExpectationsData,
  PortInfoData, PortVolumeData, ChokepointInfoData, ChokepointVolumeData,
} from '@traderalice/opentypebb'

export class SDKEconomyClient extends SDKBaseClient {
  // ==================== Core ====================

  async getCalendar(params: Record<string, unknown> = {}) {
    return this.request<EconomicCalendarData>('/calendar', params)
  }

  async getCPI(params: Record<string, unknown>) {
    return this.request<ConsumerPriceIndexData>('/cpi', params)
  }

  async getRiskPremium(params: Record<string, unknown>) {
    return this.request<RiskPremiumData>('/risk_premium', params)
  }

  async getBalanceOfPayments(params: Record<string, unknown>) {
    return this.request<BalanceOfPaymentsData>('/balance_of_payments', params)
  }

  async getMoneyMeasures(params: Record<string, unknown> = {}) {
    return this.request<MoneyMeasuresData>('/money_measures', params)
  }

  async getUnemployment(params: Record<string, unknown> = {}) {
    return this.request<UnemploymentData>('/unemployment', params)
  }

  async getCompositeLeadingIndicator(params: Record<string, unknown> = {}) {
    return this.request<CompositeLeadingIndicatorData>('/composite_leading_indicator', params)
  }

  async getCountryProfile(params: Record<string, unknown>) {
    return this.request<CountryProfileData>('/country_profile', params)
  }

  async getAvailableIndicators(params: Record<string, unknown> = {}) {
    return this.request<AvailableIndicatorsData>('/available_indicators', params)
  }

  async getIndicators(params: Record<string, unknown>) {
    return this.request<EconomicIndicatorsData>('/indicators', params)
  }

  async getCentralBankHoldings(params: Record<string, unknown> = {}) {
    return this.request<CentralBankHoldingsData>('/central_bank_holdings', params)
  }

  async getSharePriceIndex(params: Record<string, unknown> = {}) {
    return this.request<SharePriceIndexData>('/share_price_index', params)
  }

  async getHousePriceIndex(params: Record<string, unknown> = {}) {
    return this.request<HousePriceIndexData>('/house_price_index', params)
  }

  async getInterestRates(params: Record<string, unknown> = {}) {
    return this.request<CountryInterestRatesData>('/interest_rates', params)
  }

  async getRetailPrices(params: Record<string, unknown> = {}) {
    return this.request<RetailPricesData>('/retail_prices', params)
  }

  async getPrimaryDealerPositioning(params: Record<string, unknown> = {}) {
    return this.request<PrimaryDealerPositioningData>('/primary_dealer_positioning', params)
  }

  async getPCE(params: Record<string, unknown> = {}) {
    return this.request<PersonalConsumptionExpendituresData>('/pce', params)
  }

  async getExportDestinations(params: Record<string, unknown>) {
    return this.request<ExportDestinationsData>('/export_destinations', params)
  }

  async getPrimaryDealerFails(params: Record<string, unknown> = {}) {
    return this.request<PrimaryDealerFailsData>('/primary_dealer_fails', params)
  }

  async getDirectionOfTrade(params: Record<string, unknown>) {
    return this.request<DirectionOfTradeData>('/direction_of_trade', params)
  }

  async getFomcDocuments(params: Record<string, unknown> = {}) {
    return this.request<FomcDocumentsData>('/fomc_documents', params)
  }

  async getTotalFactorProductivity(params: Record<string, unknown> = {}) {
    return this.request<TotalFactorProductivityData>('/total_factor_productivity', params)
  }

  // ==================== FRED ====================

  async fredSearch(params: Record<string, unknown>) {
    return this.request<FredSearchData>('/fred_search', params)
  }

  async fredSeries(params: Record<string, unknown>) {
    return this.request<FredSeriesData>('/fred_series', params)
  }

  async fredReleaseTable(params: Record<string, unknown>) {
    return this.request<FredReleaseTableData>('/fred_release_table', params)
  }

  async fredRegional(params: Record<string, unknown>) {
    return this.request<FredRegionalData>('/fred_regional', params)
  }

  // ==================== GDP ====================

  async getGdpForecast(params: Record<string, unknown> = {}) {
    return this.request<GdpForecastData>('/gdp/forecast', params)
  }

  async getGdpNominal(params: Record<string, unknown> = {}) {
    return this.request<GdpNominalData>('/gdp/nominal', params)
  }

  async getGdpReal(params: Record<string, unknown> = {}) {
    return this.request<GdpRealData>('/gdp/real', params)
  }

  // ==================== Survey ====================

  async getBlsSeries(params: Record<string, unknown>) {
    return this.request<BlsSeriesData>('/survey/bls_series', params)
  }

  async getBlsSearch(params: Record<string, unknown>) {
    return this.request<BlsSearchData>('/survey/bls_search', params)
  }

  async getSloos(params: Record<string, unknown> = {}) {
    return this.request<SloosData>('/survey/sloos', params)
  }

  async getUniversityOfMichigan(params: Record<string, unknown> = {}) {
    return this.request<UniversityOfMichiganData>('/survey/university_of_michigan', params)
  }

  async getEconomicConditionsChicago(params: Record<string, unknown> = {}) {
    return this.request<EconomicConditionsChicagoData>('/survey/economic_conditions_chicago', params)
  }

  async getManufacturingOutlookTexas(params: Record<string, unknown> = {}) {
    return this.request<ManufacturingOutlookTexasData>('/survey/manufacturing_outlook_texas', params)
  }

  async getManufacturingOutlookNY(params: Record<string, unknown> = {}) {
    return this.request<ManufacturingOutlookNYData>('/survey/manufacturing_outlook_ny', params)
  }

  async getNonfarmPayrolls(params: Record<string, unknown> = {}) {
    return this.request<NonfarmPayrollsData>('/survey/nonfarm_payrolls', params)
  }

  async getInflationExpectations(params: Record<string, unknown> = {}) {
    return this.request<InflationExpectationsData>('/survey/inflation_expectations', params)
  }

  // ==================== Shipping ====================

  async getPortInfo(params: Record<string, unknown> = {}) {
    return this.request<PortInfoData>('/shipping/port_info', params)
  }

  async getPortVolume(params: Record<string, unknown> = {}) {
    return this.request<PortVolumeData>('/shipping/port_volume', params)
  }

  async getChokepointInfo(params: Record<string, unknown> = {}) {
    return this.request<ChokepointInfoData>('/shipping/chokepoint_info', params)
  }

  async getChokepointVolume(params: Record<string, unknown> = {}) {
    return this.request<ChokepointVolumeData>('/shipping/chokepoint_volume', params)
  }
}
