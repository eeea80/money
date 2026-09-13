import { describe, it, expect } from 'vitest'
import { fetchShipping } from './shipping.js'
import type { EconomyClientLike } from '../client/types.js'

function mkClient(impl: (params: Record<string, unknown>) => Promise<unknown[]>): EconomyClientLike {
  return { getChokepointVolume: impl } as unknown as EconomyClientLike
}

describe('shipping board', () => {
  it('builds sorted curves with the resolved chokepoint name', async () => {
    const client = mkClient(async ({ chokepoint }) => [
      { date: '2026-06-02', chokepoint: 'Suez Canal', vessels_total: 41, volume: 1.5e6 },
      { date: '2026-06-01', chokepoint: 'Suez Canal', vessels_total: 39, volume: 1.4e6 },
    ].map((r) => (chokepoint === 'suez' ? r : { ...r, chokepoint: String(chokepoint) })))
    const board = await fetchShipping(client)
    const suez = board.curves.find((c) => c.key === 'suez')!
    expect(suez.name).toBe('Suez Canal')
    expect(suez.points[0].date).toBe('2026-06-01')
    expect(suez.latest?.tons).toBe(1.5e6)
    expect(board.curves).toHaveLength(6)
    expect(board.meta.provider).toBe('imf-portwatch')
  })

  it('annotates per-chokepoint failures; throws when all fail', async () => {
    const partial = mkClient(async ({ chokepoint }) => {
      if (chokepoint === 'panama') throw new Error('ArcGIS down')
      return [{ date: '2026-06-01', chokepoint: 'X', vessels_total: 1, volume: 1 }]
    })
    const board = await fetchShipping(partial)
    expect(board.errors?.panama).toMatch(/ArcGIS/)
    expect(board.curves).toHaveLength(5)

    const dead = mkClient(async () => { throw new Error('ArcGIS down') })
    await expect(fetchShipping(dead)).rejects.toThrow(/ArcGIS/)
  })
})
