/**
 * OECD Provider Module.
 * Maps to: openbb_platform/providers/oecd/openbb_oecd/__init__.py
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { OECDCompositeLeadingIndicatorFetcher } from './models/composite-leading-indicator.js'
import { OECDConsumerPriceIndexFetcher } from './models/consumer-price-index.js'
import { OECDCountryInterestRatesFetcher } from './models/country-interest-rates.js'
import { OECDGdpForecastFetcher } from './models/gdp-forecast.js'
import { OECDGdpNominalFetcher } from './models/gdp-nominal.js'
import { OECDGdpRealFetcher } from './models/gdp-real.js'
import { OECDSharePriceIndexFetcher } from './models/share-price-index.js'
import { OECDHousePriceIndexFetcher } from './models/house-price-index.js'
import { OECDRetailPricesFetcher } from './models/retail-prices.js'

export const oecdProvider = new Provider({
  name: 'oecd',
  website: 'https://data.oecd.org',
  description: 'OECD provides international economic, social, and environmental data.',
  fetcherDict: {
    CompositeLeadingIndicator: OECDCompositeLeadingIndicatorFetcher,
    ConsumerPriceIndex: OECDConsumerPriceIndexFetcher,
    CountryInterestRates: OECDCountryInterestRatesFetcher,
    GdpForecast: OECDGdpForecastFetcher,
    GdpNominal: OECDGdpNominalFetcher,
    GdpReal: OECDGdpRealFetcher,
    SharePriceIndex: OECDSharePriceIndexFetcher,
    HousePriceIndex: OECDHousePriceIndexFetcher,
    RetailPrices: OECDRetailPricesFetcher,
  },
})
