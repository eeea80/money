/**
 * Instrument helpers — shared between Deposit / Trade tabs.
 *
 * The simulator's nativeKey is whatever `MockBroker.getNativeKey` returns
 * for a contract: `localSymbol || symbol`. To make multi-family scenarios
 * coexist (BTC spot vs BTC perp; AAPL stock vs AAPL Jul20 150C), we
 * derive a unique `localSymbol` per instrument shape and use it as the
 * nativeKey too — so positions land in distinct map slots and the user
 * gets a readable identifier without manually composing IBKR-format
 * localSymbols (e.g. `AAPL  240720C00150000`).
 */

import type { SimulatorContractInput } from '../../api/simulator'

export type SecType = 'CRYPTO' | 'CRYPTO_PERP' | 'STK' | 'FUT' | 'OPT' | 'FOP' | 'CASH' | 'BOND'

export const SEC_TYPES: SecType[] = ['CRYPTO', 'CRYPTO_PERP', 'STK', 'FUT', 'OPT', 'FOP', 'CASH', 'BOND']

export interface InstrumentDraft {
  symbol: string
  secType: SecType
  /** YYYYMMDD for OPT/FOP; YYYYMM for FUT. */
  expiry?: string
  strike?: string
  right?: 'C' | 'P'
  multiplier?: string
}

export interface BuiltInstrument {
  nativeKey: string
  contract: SimulatorContractInput
}

/** Default multiplier per secType when user hasn't set one. */
function defaultMultiplier(secType: SecType): string | undefined {
  if (secType === 'OPT' || secType === 'FOP') return '100'
  if (secType === 'FUT') return '1'
  return undefined
}

/**
 * Translate user form state into nativeKey + contract payload. Returns
 * null + a reason string when the draft isn't complete enough yet (e.g.
 * OPT without expiry); the UI shows the reason inline.
 */
export function buildInstrument(input: InstrumentDraft): BuiltInstrument | { error: string } {
  const symbol = input.symbol.trim().toUpperCase()
  if (!symbol) return { error: 'symbol required' }
  const sec = input.secType

  const contract: SimulatorContractInput = { symbol, secType: sec }

  if (sec === 'OPT' || sec === 'FOP') {
    if (!input.expiry) return { error: `${sec} needs expiry (YYYYMMDD)` }
    if (!input.strike) return { error: `${sec} needs strike` }
    if (!input.right) return { error: `${sec} needs right (C/P)` }
    const strikeNum = Number(input.strike)
    if (!Number.isFinite(strikeNum)) return { error: 'strike must be a number' }
    const nativeKey = `${symbol}-${input.expiry}-${input.right}${input.strike}`
    contract.lastTradeDateOrContractMonth = input.expiry
    contract.strike = strikeNum
    contract.right = input.right
    contract.multiplier = input.multiplier?.trim() || defaultMultiplier(sec)
    contract.localSymbol = nativeKey
    return { nativeKey, contract }
  }

  if (sec === 'FUT') {
    if (!input.expiry) return { error: 'FUT needs expiry (YYYYMM)' }
    const nativeKey = `${symbol}-${input.expiry}`
    contract.lastTradeDateOrContractMonth = input.expiry
    contract.multiplier = input.multiplier?.trim() || defaultMultiplier(sec)
    contract.localSymbol = nativeKey
    return { nativeKey, contract }
  }

  // Plain symbol-only types: STK, CRYPTO, CRYPTO_PERP, CASH, BOND
  contract.localSymbol = symbol
  return { nativeKey: symbol, contract }
}

/** Format a built instrument for display, e.g. "AAPL Jul20 150C" or "ES Mar26". */
export function describeInstrument(contract: SimulatorContractInput): string {
  const sym = contract.symbol ?? '?'
  const sec = contract.secType
  if ((sec === 'OPT' || sec === 'FOP') && contract.lastTradeDateOrContractMonth && contract.strike != null && contract.right) {
    const expiry = formatExpiry(contract.lastTradeDateOrContractMonth)
    const right = contract.right === 'C' || contract.right === 'CALL' ? 'C' : 'P'
    return `${sym} ${expiry} ${contract.strike}${right}`
  }
  if (sec === 'FUT' && contract.lastTradeDateOrContractMonth) {
    return `${sym} ${formatExpiry(contract.lastTradeDateOrContractMonth)}`
  }
  return sym
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatExpiry(raw: string): string {
  // YYYYMMDD → "Jul20" (month + day-of-month)
  // YYYYMM   → "Mar26" (month + year-yy)
  if (/^\d{8}$/.test(raw)) {
    const month = Number(raw.slice(4, 6))
    const day = raw.slice(6, 8)
    return MONTHS[month - 1] ? `${MONTHS[month - 1]}${day}` : raw
  }
  if (/^\d{6}$/.test(raw)) {
    const month = Number(raw.slice(4, 6))
    const yy = raw.slice(2, 4)
    return MONTHS[month - 1] ? `${MONTHS[month - 1]}${yy}` : raw
  }
  return raw
}
