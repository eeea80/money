/**
 * SDK Derivatives Client
 *
 * Maps to openTypeBB derivatives-router endpoints.
 */

import type {
  FuturesHistoricalData, FuturesCurveData, FuturesInfoData, FuturesInstrumentsData,
  OptionsChainsData, OptionsSnapshotsData, OptionsUnusualData,
} from '@traderalice/opentypebb'
import { SDKBaseClient } from './base-client.js'

export class SDKDerivativesClient extends SDKBaseClient {
  // ==================== Futures ====================

  async getFuturesHistorical(params: Record<string, unknown>) {
    return this.request<FuturesHistoricalData>('/futures/historical', params)
  }

  async getFuturesCurve(params: Record<string, unknown>) {
    return this.request<FuturesCurveData>('/futures/curve', params)
  }

  async getFuturesInfo(params: Record<string, unknown>) {
    return this.request<FuturesInfoData>('/futures/info', params)
  }

  async getFuturesInstruments(params: Record<string, unknown> = {}) {
    return this.request<FuturesInstrumentsData>('/futures/instruments', params)
  }

  // ==================== Options ====================

  async getOptionsChains(params: Record<string, unknown>) {
    return this.request<OptionsChainsData>('/options/chains', params)
  }

  async getOptionsSnapshots(params: Record<string, unknown> = {}) {
    return this.request<OptionsSnapshotsData>('/options/snapshots', params)
  }

  async getOptionsUnusual(params: Record<string, unknown> = {}) {
    return this.request<OptionsUnusualData>('/options/unusual', params)
  }
}
