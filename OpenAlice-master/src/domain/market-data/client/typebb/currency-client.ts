/**
 * SDK Currency Client
 *
 * Drop-in replacement for OpenBBCurrencyClient.
 */

import type { CurrencyHistoricalData, CurrencySnapshotsData } from '@traderalice/opentypebb'
import { SDKBaseClient } from './base-client.js'

export class SDKCurrencyClient extends SDKBaseClient {
  async getHistorical(params: Record<string, unknown>) {
    return this.request<CurrencyHistoricalData>('/price/historical', params)
  }

  async search(params: Record<string, unknown>) {
    return this.request('/search', params)
  }

  async getReferenceRates(params: Record<string, unknown>) {
    return this.request('/reference_rates', params)
  }

  async getSnapshots(params: Record<string, unknown>) {
    return this.request<CurrencySnapshotsData>('/snapshots', params)
  }
}
