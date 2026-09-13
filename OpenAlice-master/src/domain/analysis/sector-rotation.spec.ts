/**
 * Sector rotation compute unit tests.
 *
 * Synthetic histories: most sectors flat; XLK engineered to rotate IN (sharp
 * recent price rise + volume surge), XLU to rotate OUT (recent decline + volume
 * fade). Asserts ranking, structure, and the derived metrics.
 */
import { describe, it, expect } from 'vitest'
import type { OhlcvData } from './indicator/types'
import {
  computeSectorRotation,
  GICS_SECTOR_ETFS,
  BENCHMARK_SYMBOL,
} from './sector-rotation'

const BARS = 150
const d = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10)

function series(closeFn: (i: number) => number, volFn: (i: number) => number): OhlcvData[] {
  return Array.from({ length: BARS }, (_, i) => {
    const close = closeFn(i)
    return { date: d(i), open: close, high: close, low: close, close, volume: volFn(i) }
  })
}

const flat = (): OhlcvData[] => series(() => 100, () => 1000)

// XLK — rotating in: flat then a sharp last-20-bar rise + volume surge.
const rotatingIn = (): OhlcvData[] =>
  series(
    (i) => (i <= 129 ? 100 : 100 + (i - 129) * 2),
    (i) => (i <= 129 ? 1000 : 1000 + (i - 129) * 400),
  )

// XLU — rotating out: slow rise then a last-20-bar decline + volume fade.
const rotatingOut = (): OhlcvData[] =>
  series(
    (i) => (i <= 129 ? 100 + i * 0.2 : 100 + 129 * 0.2 - (i - 129) * 1.5),
    (i) => (i <= 129 ? 1000 : Math.max(100, 1000 - (i - 129) * 40)),
  )

function buildHistories(): Record<string, OhlcvData[]> {
  const h: Record<string, OhlcvData[]> = { [BENCHMARK_SYMBOL]: flat() }
  for (const e of GICS_SECTOR_ETFS) {
    h[e.symbol] = e.symbol === 'XLK' ? rotatingIn() : e.symbol === 'XLU' ? rotatingOut() : flat()
  }
  return h
}

describe('computeSectorRotation', () => {
  const result = computeSectorRotation(buildHistories())

  it('returns all 11 sectors + the SPY benchmark separately', () => {
    expect(result.sectors).toHaveLength(11)
    expect(result.benchmark.symbol).toBe('SPY')
    expect(result.sectors.some((s) => s.symbol === 'SPY')).toBe(false)
  })

  it('ranks the rotating-in sector first and rotating-out last', () => {
    expect(result.sectors[0].symbol).toBe('XLK')
    expect(result.sectors[result.sectors.length - 1].symbol).toBe('XLU')
  })

  it('rotation_score is sorted descending', () => {
    const scores = result.sectors.map((s) => s.rotation_score ?? -Infinity)
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i])
  })

  it('rotating-in scores positive, rotating-out negative', () => {
    const xlk = result.sectors.find((s) => s.symbol === 'XLK')!
    const xlu = result.sectors.find((s) => s.symbol === 'XLU')!
    expect(xlk.rotation_score!).toBeGreaterThan(0)
    expect(xlu.rotation_score!).toBeLessThan(0)
  })

  it('computes multi-period returns and rel_strength vs SPY', () => {
    const xlk = result.sectors.find((s) => s.symbol === 'XLK')!
    // close 100 → 140 over the last 21 bars = +40%
    expect(xlk.returns['1M']).toBeCloseTo(0.4, 2)
    // SPY is flat, so rel_strength == raw return
    expect(xlk.rel_strength['1M']).toBeCloseTo(0.4, 2)
    expect(result.benchmark.returns['1M']).toBe(0)
  })

  it('momentum_acceleration: positive for rotating-in, negative for rotating-out', () => {
    expect(result.sectors.find((s) => s.symbol === 'XLK')!.momentum_acceleration!).toBeGreaterThan(0)
    expect(result.sectors.find((s) => s.symbol === 'XLU')!.momentum_acceleration!).toBeLessThan(0)
  })

  it('dv_share is a normalized fraction summing to ~1 across sectors', () => {
    const total = result.sectors.reduce((s, r) => s + (r.dv_share ?? 0), 0)
    expect(total).toBeCloseTo(1, 2)
  })

  it('rotating-in shows rising volume share, rotating-out falling', () => {
    expect(result.sectors.find((s) => s.symbol === 'XLK')!.dv_share_change!).toBeGreaterThan(0)
    expect(result.sectors.find((s) => s.symbol === 'XLU')!.dv_share_change!).toBeLessThan(0)
  })

  it('asOf is the latest bar date', () => {
    expect(result.asOf).toBe(d(BARS - 1))
  })

  it('a sector with no data sinks to the bottom with null score', () => {
    const h = buildHistories()
    h['XLF'] = []
    const r = computeSectorRotation(h)
    const xlf = r.sectors.find((s) => s.symbol === 'XLF')!
    expect(xlf.rotation_score).toBeNull()
    expect(xlf.bars).toBe(0)
    expect(r.sectors[r.sectors.length - 1].symbol).toBe('XLF')
  })
})
