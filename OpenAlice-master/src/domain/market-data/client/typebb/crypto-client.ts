/**
 * SDK Crypto Client
 *
 * Drop-in replacement for OpenBBCryptoClient.
 */

import type { CryptoHistoricalData, CryptoSearchData } from '@traderalice/opentypebb'
import { SDKBaseClient } from './base-client.js'

export class SDKCryptoClient extends SDKBaseClient {
  async getHistorical(params: Record<string, unknown>) {
    return this.request<CryptoHistoricalData>('/price/historical', params)
  }

  async search(params: Record<string, unknown>) {
    return this.request<CryptoSearchData>('/search', params)
  }
}
