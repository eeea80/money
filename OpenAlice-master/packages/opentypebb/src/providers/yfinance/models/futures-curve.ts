/**
 * Yahoo Finance Futures Curve Model.
 * Maps to: openbb_yfinance/models/futures_curve.py
 *
 * Uses Yahoo Finance's futuresChain API to get the list of active futures symbols,
 * then fetches current quotes for each. Falls back to manual symbol construction
 * with an exchange mapping if the chain API is unavailable.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { FuturesCurveQueryParamsSchema, FuturesCurveDataSchema } from '../../../standard-models/futures-curve.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getFuturesSymbols, getHistoricalData, getQuoteSummary } from '../utils/helpers.js'
import { MONTHS } from '../utils/references.js'

export const YFinanceFuturesCurveQueryParamsSchema = FuturesCurveQueryParamsSchema
export type YFinanceFuturesCurveQueryParams = z.infer<typeof YFinanceFuturesCurveQueryParamsSchema>

export const YFinanceFuturesCurveDataSchema = FuturesCurveDataSchema
export type YFinanceFuturesCurveData = z.infer<typeof YFinanceFuturesCurveDataSchema>

/** Reverse map: futures month letter → month number string */
const MONTH_MAP: Record<string, string> = {
  F: '01', G: '02', H: '03', J: '04', K: '05', M: '06',
  N: '07', Q: '08', U: '09', V: '10', X: '11', Z: '12',
}

/** Extract expiration year-month from a futures ticker like CLF26.NYM → 2026-01 */
function getExpirationMonth(symbol: string): string {
  const base = symbol.split('.')[0]
  if (base.length < 3) return ''
  const monthLetter = base[base.length - 3]
  const yearStr = base.slice(-2)
  const month = MONTH_MAP[monthLetter]
  if (!month) return ''
  return `20${yearStr}-${month}`
}

/** Map of common futures symbols to their Yahoo Finance exchange suffix */
const EXCHANGE_MAP: Record<string, string> = {
  CL: 'NYM',  // Crude Oil → NYMEX
  NG: 'NYM',  // Natural Gas → NYMEX
  HO: 'NYM',  // Heating Oil → NYMEX
  RB: 'NYM',  // RBOB Gasoline → NYMEX
  PL: 'NYM',  // Platinum → NYMEX
  PA: 'NYM',  // Palladium → NYMEX
  GC: 'CMX',  // Gold → COMEX
  SI: 'CMX',  // Silver → COMEX
  HG: 'CMX',  // Copper → COMEX
  ES: 'CME',  // E-mini S&P 500 → CME
  NQ: 'CME',  // E-mini Nasdaq 100 → CME
  RTY: 'CME', // E-mini Russell 2000 → CME
  YM: 'CBT',  // E-mini Dow → CBOT
  LE: 'CME',  // Live Cattle → CME
  HE: 'CME',  // Lean Hogs → CME
  GF: 'CME',  // Feeder Cattle → CME
  ZB: 'CBT',  // T-Bond → CBOT
  ZN: 'CBT',  // 10-Yr Note → CBOT
  ZF: 'CBT',  // 5-Yr Note → CBOT
  ZT: 'CBT',  // 2-Yr Note → CBOT
  ZC: 'CBT',  // Corn → CBOT
  ZS: 'CBT',  // Soybeans → CBOT
  ZW: 'CBT',  // Wheat → CBOT
  ZM: 'CBT',  // Soybean Meal → CBOT
  ZL: 'CBT',  // Soybean Oil → CBOT
  ZO: 'CBT',  // Oats → CBOT
  KC: 'NYB',  // Coffee → NYBOT/ICE
  CT: 'NYB',  // Cotton → NYBOT/ICE
  SB: 'NYB',  // Sugar → NYBOT/ICE
  CC: 'NYB',  // Cocoa → NYBOT/ICE
  OJ: 'NYB',  // Orange Juice → NYBOT/ICE
}

/** Generate manual futures symbols for next N months */
function generateFuturesSymbols(baseSymbol: string, exchange: string, numMonths = 36): string[] {
  const symbols: string[] = []
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  for (let i = 0; i < numMonths; i++) {
    const month = ((currentMonth - 1 + i) % 12) + 1
    const yearOffset = Math.floor((currentMonth - 1 + i) / 12)
    const year = (currentYear + yearOffset) % 100
    const monthCode = MONTHS[month]
    if (monthCode) {
      const yearStr = year.toString().padStart(2, '0')
      symbols.push(`${baseSymbol}${monthCode}${yearStr}.${exchange}`)
    }
  }

  return symbols
}

export class YFinanceFuturesCurveFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceFuturesCurveQueryParams {
    return YFinanceFuturesCurveQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceFuturesCurveQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const baseSymbol = query.symbol.replace(/=F$/i, '').toUpperCase()

    // Step 1: Try to get the futures chain from Yahoo's API (like Python's get_futures_symbols)
    let chainSymbols = await getFuturesSymbols(baseSymbol)

    // Step 2: If no chain from API, manually construct symbols with exchange mapping
    if (!chainSymbols.length) {
      const exchange = EXCHANGE_MAP[baseSymbol] ?? 'CME'
      chainSymbols = generateFuturesSymbols(baseSymbol, exchange)
    }

    // Step 3: Fetch current price for each symbol
    const today = new Date().toISOString().slice(0, 10)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const results = await Promise.allSettled(
      chainSymbols.map(async (sym) => {
        try {
          const data = await getHistoricalData(sym, {
            startDate: weekAgo,
            endDate: today,
            interval: '1d',
          })
          if (!data.length) return null
          const last = data[data.length - 1]
          const expiration = getExpirationMonth(sym)
          if (!expiration) return null
          return {
            expiration,
            price: last.close ?? last.open ?? null,
          }
        } catch {
          return null
        }
      })
    )

    const curve: Record<string, unknown>[] = []
    let consecutiveEmpty = 0
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        curve.push(r.value)
        consecutiveEmpty = 0
      } else {
        consecutiveEmpty++
        // Stop after 12 consecutive empty (matches Python behavior)
        if (consecutiveEmpty >= 12 && curve.length > 0) break
      }
    }

    if (!curve.length) throw new EmptyDataError(`No futures curve data for ${query.symbol}`)

    // Sort by expiration
    curve.sort((a, b) => String(a.expiration).localeCompare(String(b.expiration)))
    return curve
  }

  static override transformData(
    _query: YFinanceFuturesCurveQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceFuturesCurveData[] {
    return data.map(d => YFinanceFuturesCurveDataSchema.parse(d))
  }
}
