import { afterEach, describe, expect, it, vi } from 'vitest'

import { tradingApi } from './trading'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tradingApi Broker Packs', () => {
  it('posts an install request and normalizes the route response for UI state', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      engine: 'ccxt', installed: true, source: 'downloaded', version: '0.80.0-beta',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(tradingApi.installBrokerPack('ccxt')).resolves.toMatchObject({
      engine: 'ccxt', installed: true, source: 'downloaded', requiredBy: [],
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/trading/config/broker-packs/ccxt/install', { method: 'POST' })
  })

  it('surfaces the server diagnostic on install failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'longbridge requires glibc 2.39+',
    }), { status: 400, headers: { 'content-type': 'application/json' } })))

    await expect(tradingApi.installBrokerPack('longbridge')).rejects.toThrow(/requires glibc 2\.39/i)
  })

  it('falls back to the HTTP status when an error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream unavailable', { status: 503 })))

    await expect(tradingApi.installBrokerPack('alpaca')).rejects.toThrow(/Failed to install alpaca support \(503\)/i)
  })
})
