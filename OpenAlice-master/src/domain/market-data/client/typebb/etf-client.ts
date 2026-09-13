/**
 * SDK ETF Client
 *
 * Maps to openTypeBB etf-router endpoints.
 */

import type {
  EtfSearchData, EtfInfoData, EtfHoldingsData,
  EtfSectorsData, EtfCountriesData, EtfEquityExposureData,
} from '@traderalice/opentypebb'
import { SDKBaseClient } from './base-client.js'

export class SDKEtfClient extends SDKBaseClient {
  async search(params: Record<string, unknown>) {
    return this.request<EtfSearchData>('/search', params)
  }

  async getInfo(params: Record<string, unknown>) {
    return this.request<EtfInfoData>('/info', params)
  }

  async getHoldings(params: Record<string, unknown>) {
    return this.request<EtfHoldingsData>('/holdings', params)
  }

  async getSectors(params: Record<string, unknown>) {
    return this.request<EtfSectorsData>('/sectors', params)
  }

  async getCountries(params: Record<string, unknown>) {
    return this.request<EtfCountriesData>('/countries', params)
  }

  async getEquityExposure(params: Record<string, unknown>) {
    return this.request<EtfEquityExposureData>('/equity_exposure', params)
  }

  async getHistorical(params: Record<string, unknown>) {
    return this.request('/historical', params)
  }
}
