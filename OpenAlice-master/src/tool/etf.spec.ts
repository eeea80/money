/**
 * ETF tool fallback chain — FMP first, keyless yfinance when FMP rejects
 * (missing key / suspended account). The micro version of the hub's
 * per-cell provider chain.
 */

import { describe, it, expect, vi } from 'vitest'
import { createEtfTools } from './etf.js'
import type { EtfClientLike } from '@/domain/market-data/client/types'

const exec = (t: unknown, args: unknown) => ((t as { execute: Function }).execute)(args)

function mkClient(impl: Partial<EtfClientLike>): EtfClientLike {
  return impl as EtfClientLike
}

describe('etf tools provider fallback', () => {
  it('uses FMP when it works', async () => {
    const getSectors = vi.fn(async () => [{ symbol: 'XLK', sector: 'Technology', weight: 0.99 }])
    const tools = createEtfTools(mkClient({ getSectors }))
    const rows = await exec(tools.etfGetSectors, { symbol: 'XLK' })
    expect(rows).toHaveLength(1)
    expect(getSectors).toHaveBeenCalledTimes(1)
    expect((getSectors.mock.calls[0] as unknown[])[0]).toMatchObject({ provider: 'fmp' })
  })

  it('falls back to yfinance when FMP rejects', async () => {
    const getHoldings = vi.fn(async ({ provider }: { provider?: string }) => {
      if (provider === 'fmp') throw new Error('Unauthorized FMP request -> 403')
      return [{ symbol: 'NVDA', name: 'NVIDIA Corp', weight: 0.0789 }]
    })
    const tools = createEtfTools(mkClient({ getHoldings: getHoldings as never }))
    const rows = await exec(tools.etfGetHoldings, { symbol: 'SPY' })
    expect(rows[0].symbol).toBe('NVDA')
    expect(getHoldings).toHaveBeenCalledTimes(2)
    expect((getHoldings.mock.calls[1] as unknown[])[0]).toMatchObject({ provider: 'yfinance' })
  })

  it('surfaces the yfinance error when both providers fail', async () => {
    const dead = vi.fn(async () => { throw new Error('yahoo down') })
    const tools = createEtfTools(mkClient({ getSectors: dead as never }))
    await expect(exec(tools.etfGetSectors, { symbol: 'XLK' })).rejects.toThrow(/yahoo down/)
  })
})
