/**
 * Technical indicator functions — 纯数学计算
 *
 * Trend / momentum:  RSI, BBANDS, MACD, ATR
 * Volume (right-side): RVOL, OBV, MFI, VWAP
 * 接受 number[] 或 TrackedValues（自动提取 values）
 */

import { toValues, type TrackedValues } from '../types'
import { EMA } from './statistics'

type NumericInput = number[] | TrackedValues

/** Relative Strength Index (RSI) */
export function RSI(data: NumericInput, period: number = 14): number {
  const v = toValues(data)
  if (v.length < period + 1) {
    throw new Error(`RSI requires at least ${period + 1} data points, got ${v.length}`)
  }

  const changes: number[] = []
  for (let i = 1; i < v.length; i++) {
    changes.push(v[i] - v[i - 1])
  }

  const gains = changes.map((c) => (c > 0 ? c : 0))
  const losses = changes.map((c) => (c < 0 ? -c : 0))

  let avgGain = gains.slice(0, period).reduce((acc, val) => acc + val, 0) / period
  let avgLoss = losses.slice(0, period).reduce((acc, val) => acc + val, 0) / period

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
  }

  if (avgLoss === 0) {
    return 100
  }

  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** Bollinger Bands (BBANDS) */
export function BBANDS(
  data: NumericInput,
  period: number = 20,
  stdDevMultiplier: number = 2,
): { upper: number; middle: number; lower: number } {
  const v = toValues(data)
  if (v.length < period) {
    throw new Error(`BBANDS requires at least ${period} data points, got ${v.length}`)
  }

  const slice = v.slice(-period)
  const middle = slice.reduce((acc, val) => acc + val, 0) / period
  const variance = slice.reduce((acc, val) => acc + Math.pow(val - middle, 2), 0) / period
  const stdDev = Math.sqrt(variance)

  return {
    upper: middle + stdDev * stdDevMultiplier,
    middle,
    lower: middle - stdDev * stdDevMultiplier,
  }
}

/** MACD (Moving Average Convergence Divergence) */
export function MACD(
  data: NumericInput,
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): { macd: number; signal: number; histogram: number } {
  const v = toValues(data)
  if (v.length < slowPeriod + signalPeriod) {
    throw new Error(
      `MACD requires at least ${slowPeriod + signalPeriod} data points, got ${v.length}`,
    )
  }

  const fastEMA = EMA(v, fastPeriod)
  const slowEMA = EMA(v, slowPeriod)
  const macdValue = fastEMA - slowEMA

  const macdHistory: number[] = []
  for (let i = slowPeriod; i <= v.length; i++) {
    const slice = v.slice(0, i)
    const fast = EMA(slice, fastPeriod)
    const slow = EMA(slice, slowPeriod)
    macdHistory.push(fast - slow)
  }

  const signalValue = EMA(macdHistory, signalPeriod)
  const histogram = macdValue - signalValue

  return {
    macd: macdValue,
    signal: signalValue,
    histogram,
  }
}

/** Average True Range (ATR) */
export function ATR(
  highs: NumericInput,
  lows: NumericInput,
  closes: NumericInput,
  period: number = 14,
): number {
  const h = toValues(highs)
  const l = toValues(lows)
  const c = toValues(closes)
  if (h.length !== l.length || l.length !== c.length || h.length < period + 1) {
    throw new Error(`ATR requires at least ${period + 1} data points for all arrays`)
  }

  const trueRanges: number[] = []
  for (let i = 1; i < h.length; i++) {
    const tr = Math.max(
      h[i] - l[i],
      Math.abs(h[i] - c[i - 1]),
      Math.abs(l[i] - c[i - 1]),
    )
    trueRanges.push(tr)
  }

  let atr = trueRanges.slice(0, period).reduce((acc, val) => acc + val, 0) / period
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period
  }

  return atr
}

/**
 * Relative Volume (RVOL) — latest bar's volume divided by the average of the
 * preceding `period` bars. The single most useful right-side read: absolute
 * volume is meaningless across tickers (10M shares is huge for one, noise for
 * another); RVOL normalizes it against the symbol's own baseline. >1 means
 * the bar is trading heavier than usual; a 2–3+ print on a move is the
 * volume-confirmation signal momentum traders look for.
 */
export function RVOL(volumes: NumericInput, period: number = 20): number {
  const v = toValues(volumes)
  if (v.length < period + 1) {
    throw new Error(`RVOL requires at least ${period + 1} data points, got ${v.length}`)
  }

  const latest = v[v.length - 1]
  const prior = v.slice(-period - 1, -1) // the `period` bars before the latest
  const avg = prior.reduce((acc, val) => acc + val, 0) / period

  if (avg === 0) {
    throw new Error('RVOL requires a non-zero average baseline volume')
  }

  return latest / avg
}

/**
 * On-Balance Volume (OBV) — running total that adds the bar's volume on an
 * up-close and subtracts it on a down-close. Returns the latest cumulative
 * value; its slope (vs price) is what carries the accumulation/distribution
 * signal. Pair with CLOSE and VOLUME of the same length.
 */
export function OBV(closes: NumericInput, volumes: NumericInput): number {
  const c = toValues(closes)
  const vol = toValues(volumes)
  if (c.length !== vol.length || c.length < 2) {
    throw new Error(
      `OBV requires closes and volumes of equal length (>= 2), got ${c.length} and ${vol.length}`,
    )
  }

  let obv = 0
  for (let i = 1; i < c.length; i++) {
    if (c[i] > c[i - 1]) obv += vol[i]
    else if (c[i] < c[i - 1]) obv -= vol[i]
    // unchanged close: OBV unchanged
  }

  return obv
}

/**
 * Money Flow Index (MFI) — a volume-weighted RSI on the typical price
 * ((H+L+C)/3), bounded 0–100. Above ~80 = overbought on heavy money inflow,
 * below ~20 = oversold. Needs highs/lows/closes/volumes of equal length.
 */
export function MFI(
  highs: NumericInput,
  lows: NumericInput,
  closes: NumericInput,
  volumes: NumericInput,
  period: number = 14,
): number {
  const h = toValues(highs)
  const l = toValues(lows)
  const c = toValues(closes)
  const vol = toValues(volumes)
  if (
    h.length !== l.length ||
    l.length !== c.length ||
    c.length !== vol.length ||
    h.length < period + 1
  ) {
    throw new Error(`MFI requires at least ${period + 1} data points for all arrays`)
  }

  const typical = h.map((_, i) => (h[i] + l[i] + c[i]) / 3)

  let positiveFlow = 0
  let negativeFlow = 0
  for (let i = h.length - period; i < h.length; i++) {
    const rawFlow = typical[i] * vol[i]
    if (typical[i] > typical[i - 1]) positiveFlow += rawFlow
    else if (typical[i] < typical[i - 1]) negativeFlow += rawFlow
  }

  if (negativeFlow === 0) return 100
  const moneyRatio = positiveFlow / negativeFlow
  return 100 - 100 / (1 + moneyRatio)
}

/**
 * Volume-Weighted Average Price (VWAP) over the supplied series — the average
 * price weighted by volume at each bar, using the typical price ((H+L+C)/3).
 * Price above VWAP = buyers in control over the window. Needs
 * highs/lows/closes/volumes of equal length.
 */
export function VWAP(
  highs: NumericInput,
  lows: NumericInput,
  closes: NumericInput,
  volumes: NumericInput,
): number {
  const h = toValues(highs)
  const l = toValues(lows)
  const c = toValues(closes)
  const vol = toValues(volumes)
  if (
    h.length !== l.length ||
    l.length !== c.length ||
    c.length !== vol.length ||
    h.length < 1
  ) {
    throw new Error('VWAP requires high/low/close/volume arrays of equal length (>= 1)')
  }

  let priceVolume = 0
  let totalVolume = 0
  for (let i = 0; i < h.length; i++) {
    const typical = (h[i] + l[i] + c[i]) / 3
    priceVolume += typical * vol[i]
    totalVolume += vol[i]
  }

  if (totalVolume === 0) {
    throw new Error('VWAP requires non-zero total volume')
  }

  return priceVolume / totalVolume
}
