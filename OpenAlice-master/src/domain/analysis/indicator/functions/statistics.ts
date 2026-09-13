/**
 * Statistics functions — 纯数学计算
 *
 * SMA, EMA, STDEV, MAX, MIN, SUM, AVERAGE, MEDIAN, ROC, ZSCORE, SLOPE,
 * CORRELATION, HIGHEST, LOWEST
 * 接受 number[] 或 TrackedValues（自动提取 values）
 */

import { toValues, type TrackedValues } from '../types'

type NumericInput = number[] | TrackedValues

/** Simple Moving Average */
export function SMA(data: NumericInput, period: number): number {
  const v = toValues(data)
  if (v.length < period) {
    throw new Error(`SMA requires at least ${period} data points, got ${v.length}`)
  }
  const slice = v.slice(-period)
  const sum = slice.reduce((acc, val) => acc + val, 0)
  return sum / period
}

/** Exponential Moving Average */
export function EMA(data: NumericInput, period: number): number {
  const v = toValues(data)
  if (v.length < period) {
    throw new Error(`EMA requires at least ${period} data points, got ${v.length}`)
  }
  const multiplier = 2 / (period + 1)
  let ema = v.slice(0, period).reduce((acc, val) => acc + val, 0) / period
  for (let i = period; i < v.length; i++) {
    ema = (v[i] - ema) * multiplier + ema
  }
  return ema
}

/** Standard Deviation */
export function STDEV(data: NumericInput): number {
  const v = toValues(data)
  if (v.length === 0) {
    throw new Error('STDEV requires at least 1 data point')
  }
  const mean = v.reduce((acc, val) => acc + val, 0) / v.length
  const variance = v.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / v.length
  return Math.sqrt(variance)
}

/** Maximum value */
export function MAX(data: NumericInput): number {
  const v = toValues(data)
  if (v.length === 0) {
    throw new Error('MAX requires at least 1 data point')
  }
  return Math.max(...v)
}

/** Minimum value */
export function MIN(data: NumericInput): number {
  const v = toValues(data)
  if (v.length === 0) {
    throw new Error('MIN requires at least 1 data point')
  }
  return Math.min(...v)
}

/** Sum */
export function SUM(data: NumericInput): number {
  const v = toValues(data)
  return v.reduce((acc, val) => acc + val, 0)
}

/** Average */
export function AVERAGE(data: NumericInput): number {
  const v = toValues(data)
  if (v.length === 0) {
    throw new Error('AVERAGE requires at least 1 data point')
  }
  return v.reduce((acc, val) => acc + val, 0) / v.length
}

/** Median */
export function MEDIAN(data: NumericInput): number {
  const v = [...toValues(data)].sort((a, b) => a - b)
  if (v.length === 0) throw new Error('MEDIAN requires at least 1 data point')
  const mid = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** Rate of change over `period` bars, as a PERCENT: (last − prior) / prior × 100. */
export function ROC(data: NumericInput, period: number): number {
  const v = toValues(data)
  if (v.length < period + 1) {
    throw new Error(`ROC requires at least ${period + 1} data points, got ${v.length}`)
  }
  const cur = v[v.length - 1]
  const prior = v[v.length - 1 - period]
  return prior === 0 ? 0 : ((cur - prior) / prior) * 100
}

/** Z-score of the latest value vs the trailing window: (last − mean) / stdev.
 *  `period` defaults to the whole series. Population stdev (matches STDEV). */
export function ZSCORE(data: NumericInput, period?: number): number {
  const all = toValues(data)
  if (all.length === 0) throw new Error('ZSCORE requires at least 1 data point')
  const v = period ? all.slice(-period) : all
  const mean = v.reduce((a, x) => a + x, 0) / v.length
  const variance = v.reduce((a, x) => a + (x - mean) ** 2, 0) / v.length
  const sd = Math.sqrt(variance)
  const last = all[all.length - 1]
  return sd === 0 ? 0 : (last - mean) / sd
}

/** Least-squares regression slope over the last `period` points (price change
 *  per bar) — a signed, rankable trend strength. x = 0..period-1. */
export function SLOPE(data: NumericInput, period: number): number {
  const v = toValues(data).slice(-period)
  const n = v.length
  if (n < 2) throw new Error(`SLOPE requires at least 2 data points, got ${n}`)
  const sumX = (n * (n - 1)) / 2
  const sumXX = ((n - 1) * n * (2 * n - 1)) / 6
  const sumY = v.reduce((a, y) => a + y, 0)
  const sumXY = v.reduce((a, y, i) => a + i * y, 0)
  const denom = n * sumXX - sumX * sumX
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
}

/** Pearson correlation of two series, aligned from the most-recent end over the
 *  overlapping length. Returns −1..1 (0 if either series is flat). */
export function CORRELATION(a: NumericInput, b: NumericInput): number {
  const av = toValues(a)
  const bv = toValues(b)
  const n = Math.min(av.length, bv.length)
  if (n < 2) throw new Error(`CORRELATION requires at least 2 aligned points, got ${n}`)
  const A = av.slice(-n)
  const B = bv.slice(-n)
  const meanA = A.reduce((s, x) => s + x, 0) / n
  const meanB = B.reduce((s, x) => s + x, 0) / n
  let cov = 0, varA = 0, varB = 0
  for (let i = 0; i < n; i++) {
    const da = A[i] - meanA
    const db = B[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  const denom = Math.sqrt(varA * varB)
  return denom === 0 ? 0 : cov / denom
}

/** Highest value over the last `period` bars (e.g. a breakout / Donchian top). */
export function HIGHEST(data: NumericInput, period: number): number {
  const v = toValues(data).slice(-period)
  if (v.length === 0) throw new Error('HIGHEST requires at least 1 data point')
  return Math.max(...v)
}

/** Lowest value over the last `period` bars. */
export function LOWEST(data: NumericInput, period: number): number {
  const v = toValues(data).slice(-period)
  if (v.length === 0) throw new Error('LOWEST requires at least 1 data point')
  return Math.min(...v)
}
