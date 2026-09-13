/**
 * Maps `Position.contract.secType` (broker-supplied, varies by adapter)
 * to a display class for grouping in the positions table.
 *
 * IBKR's secType taxonomy ("STK" / "OPT" / "CASH" / "FUT" / etc.) is the
 * superset reference; CCXT and others normalize down to a smaller set.
 * We classify defensively — anything unrecognised falls into `other`
 * rather than guessing, so a new broker's quirk surfaces as a visible
 * "Other" group rather than getting silently lumped under Equity.
 */

export type AssetClass = 'equity' | 'option' | 'crypto' | 'forex' | 'future' | 'bond' | 'etf' | 'other'

const SECTYPE_TO_CLASS: Record<string, AssetClass> = {
  // IBKR canonical
  STK: 'equity',
  OPT: 'option',
  FUT: 'future',
  CASH: 'forex',     // IBKR uses CASH for forex pairs
  BOND: 'bond',
  // Common variants
  STOCK: 'equity',
  OPTION: 'option',
  FUTURE: 'future',
  FX: 'forex',
  FOREX: 'forex',
  CRYPTO: 'crypto',
  SPOT: 'crypto',    // CCXT-style spot
  PERP: 'future',    // CCXT-style perpetual
  SWAP: 'future',
  ETF: 'etf',
}

export function secTypeToClass(secType?: string): AssetClass {
  if (!secType) return 'other'
  return SECTYPE_TO_CLASS[secType.toUpperCase()] ?? 'other'
}

const LABELS: Record<AssetClass, string> = {
  equity: 'Equity',
  option: 'Option',
  crypto: 'Crypto',
  future: 'Futures',
  forex: 'Forex',
  bond: 'Bond',
  etf: 'ETF',
  other: 'Other',
}

export function assetClassLabel(c: AssetClass): string {
  return LABELS[c]
}

/** Stable display order for grouped positions. */
export const ASSET_CLASS_ORDER: readonly AssetClass[] = [
  'equity',
  'etf',
  'crypto',
  'option',
  'future',
  'forex',
  'bond',
  'other',
]
