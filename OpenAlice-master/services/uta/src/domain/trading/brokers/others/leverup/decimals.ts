/**
 * Decimal ↔ wei bigint conversions for LeverUp.
 *
 * LeverUp uses a non-uniform decimal scheme that's easy to get wrong:
 * - amountIn: collateral token's native decimals (USDC = 6)
 * - qty: 10 decimals (NOT 18 — protocol-specific)
 * - price / stopLoss / takeProfit: 18 decimals
 *
 * One mistake here and orders go in at 1e8x or 1e8/x the intended size.
 * All conversions are explicit-named to make miswiring loud at the call site.
 */

import Decimal from 'decimal.js'

/** Position size in base asset units (e.g., BTC). 10 decimals per LeverUp protocol. */
export const QTY_DECIMALS = 10
/** Prices, stop-loss, take-profit. 18 decimals. */
export const PRICE_DECIMALS = 18
/** USDC's native decimals — applies to `amountIn` when collateral is USDC. */
export const USDC_DECIMALS = 6

function decimalToWei(value: Decimal | string, decimals: number): bigint {
  const d = value instanceof Decimal ? value : new Decimal(value)
  // toFixed(decimals, ROUND_DOWN) truncates excess precision; protects
  // against producing a fractional wei which BigInt() would reject.
  const scaled = d.mul(new Decimal(10).pow(decimals)).toFixed(0, Decimal.ROUND_DOWN)
  return BigInt(scaled)
}

function weiToDecimal(value: bigint | string, decimals: number): Decimal {
  return new Decimal(value.toString()).div(new Decimal(10).pow(decimals))
}

export function qtyToWei(qty: Decimal | string): bigint {
  return decimalToWei(qty, QTY_DECIMALS)
}

export function weiToQty(wei: bigint | string): Decimal {
  return weiToDecimal(wei, QTY_DECIMALS)
}

export function priceToWei(price: Decimal | string): bigint {
  return decimalToWei(price, PRICE_DECIMALS)
}

export function weiToPrice(wei: bigint | string): Decimal {
  return weiToDecimal(wei, PRICE_DECIMALS)
}

export function amountInToWei(amount: Decimal | string, tokenDecimals: number): bigint {
  return decimalToWei(amount, tokenDecimals)
}

export function weiToAmountIn(wei: bigint | string, tokenDecimals: number): Decimal {
  return weiToDecimal(wei, tokenDecimals)
}
