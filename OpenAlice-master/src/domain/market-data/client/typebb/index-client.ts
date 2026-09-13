/**
 * SDK Index Client
 *
 * Maps to openTypeBB index-router endpoints.
 */

import type {
  AvailableIndicesData, IndexSearchData, IndexConstituentsData,
  IndexHistoricalData, IndexSectorsData, SP500MultiplesData, RiskPremiumData,
} from '@traderalice/opentypebb'
import { SDKBaseClient } from './base-client.js'

export class SDKIndexClient extends SDKBaseClient {
  async getAvailable(params: Record<string, unknown> = {}) {
    return this.request<AvailableIndicesData>('/available', params)
  }

  async search(params: Record<string, unknown>) {
    return this.request<IndexSearchData>('/search', params)
  }

  async getConstituents(params: Record<string, unknown>) {
    return this.request<IndexConstituentsData>('/constituents', params)
  }

  async getHistorical(params: Record<string, unknown>) {
    return this.request<IndexHistoricalData>('/price/historical', params)
  }

  async getSnapshots(params: Record<string, unknown> = {}) {
    return this.request('/snapshots', params)
  }

  async getSectors(params: Record<string, unknown>) {
    return this.request<IndexSectorsData>('/sectors', params)
  }

  async getSP500Multiples(params: Record<string, unknown> = {}) {
    return this.request<SP500MultiplesData>('/sp500_multiples', params)
  }

  async getRiskPremium(params: Record<string, unknown> = {}) {
    return this.request<RiskPremiumData>('/risk_premium', params)
  }
}
