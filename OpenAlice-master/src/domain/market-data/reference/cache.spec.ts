import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cachedBoard } from './cache.js'
import type { ReferenceMeta } from './types.js'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

const board = (n: number): { n: number; meta: ReferenceMeta } =>
  ({ n, meta: { provider: 'test', asOf: new Date().toISOString() } })

describe('reference cache', () => {
  it('serves from cache within TTL (cachedAt set), refetches after expiry', async () => {
    let calls = 0
    const get = cachedBoard(60_000, async () => { calls++; return board(calls) })

    const first = await get()
    expect(first.n).toBe(1)
    expect(first.meta.cachedAt).toBeUndefined() // fresh fetch, not a cache hit

    const second = await get()
    expect(second.n).toBe(1)
    expect(second.meta.cachedAt).toBeTruthy()   // cache hit is labeled
    expect(calls).toBe(1)

    vi.advanceTimersByTime(61_000)
    const third = await get()
    expect(third.n).toBe(2)
    expect(calls).toBe(2)
  })

  it('dedupes concurrent loads into one upstream call', async () => {
    let calls = 0
    const get = cachedBoard(60_000, async () => { calls++; return board(calls) })
    const [a, b] = await Promise.all([get(), get()])
    expect(calls).toBe(1)
    expect(a.n).toBe(1)
    expect(b.n).toBe(1)
  })

  it('stale-while-error: failed refresh serves the last good payload, marked stale', async () => {
    let calls = 0
    const get = cachedBoard(60_000, async () => {
      calls++
      if (calls > 1) throw new Error('OECD API returned 429')
      return board(calls)
    })
    await get()
    vi.advanceTimersByTime(61_000)
    const staleServe = await get()
    expect(staleServe.n).toBe(1)
    expect(staleServe.meta.stale).toBe(true)
    expect(staleServe.meta.cachedAt).toBeTruthy()
  })

  it('no last-good payload → the error stays loud', async () => {
    const get = cachedBoard(60_000, async () => { throw new Error('upstream down') })
    await expect(get()).rejects.toThrow(/upstream down/)
  })
})
