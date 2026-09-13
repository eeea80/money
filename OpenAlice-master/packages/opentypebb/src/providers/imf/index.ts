/**
 * IMF Provider Module.
 * Maps to: openbb_platform/providers/imf/openbb_imf/__init__.py
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { IMFAvailableIndicatorsFetcher } from './models/available-indicators.js'
import { IMFConsumerPriceIndexFetcher } from './models/consumer-price-index.js'
import { IMFDirectionOfTradeFetcher } from './models/direction-of-trade.js'
import { IMFEconomicIndicatorsFetcher } from './models/economic-indicators.js'
import {
  ImfPortInfoFetcher,
  ImfPortVolumeFetcher,
  ImfChokepointInfoFetcher,
  ImfChokepointVolumeFetcher,
} from './models/port-watch.js'

export const imfProvider = new Provider({
  name: 'imf',
  website: 'https://data.imf.org',
  description: 'International Monetary Fund data services.',
  fetcherDict: {
    AvailableIndicators: IMFAvailableIndicatorsFetcher,
    ConsumerPriceIndex: IMFConsumerPriceIndexFetcher,
    DirectionOfTrade: IMFDirectionOfTradeFetcher,
    EconomicIndicators: IMFEconomicIndicatorsFetcher,
    // PortWatch — satellite AIS shipping data (keyless ArcGIS layers).
    PortInfo: ImfPortInfoFetcher,
    PortVolume: ImfPortVolumeFetcher,
    ChokepointInfo: ImfChokepointInfoFetcher,
    ChokepointVolume: ImfChokepointVolumeFetcher,
  },
})
