import { headers } from './client'

export interface HubStatus {
  enabled: boolean
  baseUrl: string
  reachable: boolean
}

export const marketDataApi = {
  async testProvider(provider: string, key: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/market-data/test-provider', {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider, key }),
    })
    return res.json()
  },

  async hubStatus(baseUrl?: string): Promise<HubStatus> {
    const qs = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ''
    const res = await fetch(`/api/market-data/hub-status${qs}`, { headers })
    return res.json()
  },
}
