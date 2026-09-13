/**
 * OrderHelper — single authority for the IBKR Order sentinel boundary.
 *
 * The `Order` class in @traderalice/ibkr mirrors IBKR's binary wire
 * protocol: every optional Decimal field defaults to UNSET_DECIMAL = 2^127-1
 * rather than `undefined`, because the protocol can't express "field absent."
 * That convention is legitimate inside broker implementations where both
 * sides recognise the sentinel.
 *
 * It is catastrophic the moment it crosses a JSON boundary into UI / MCP /
 * Telegram — without the sender/receiver agreement, 1.7e38 looks like a real
 * price. The 2026-05-13 incident ("BUY 0.0005 BTC/USDT MKT @ 1.7e38" in
 * PushApprovalPanel) is exactly that.
 *
 * This module is where "which Order fields use a sentinel" lives, and the
 * only authority for Order ↔ wire-clean shape conversion. It sits at UTA
 * level (not in `git/` or `brokers/`) so anyone editing trading code sees
 * it. Enforcement: `TradingGit.stagingArea` is private — every public
 * observer (status / log / show / exportState) routes through `toWire`
 * here, so external consumers cannot accidentally receive a sentinel-
 * tainted shape.
 *
 * Two APIs:
 *   - read(order)   → typed OrderView, sentinel → undefined.
 *                     For broker-internal consumption (replaces the
 *                     `if (!x.equals(UNSET_DECIMAL))` template).
 *   - toWire(order) → plain object, sentinel fields removed.
 *                     For anything crossing a JSON boundary.
 */

import Decimal from 'decimal.js'
import type { Order } from '@traderalice/ibkr'
import { UNSET_DECIMAL } from '@traderalice/ibkr'

// Add new Decimal-valued optional Order fields here too.
const SENTINEL_DECIMAL_FIELDS = [
  'totalQuantity',
  'cashQty',
  'lmtPrice',
  'auxPrice',
  'trailStopPrice',
  'trailingPercent',
  'filledQuantity',
] as const

/**
 * Narrow nullable view for broker-internal consumption. Only the fields
 * OpenAlice actually uses across brokers — the full 200-field Order remains
 * the broker interface contract (IBKR-as-superset principle).
 */
export interface OrderView {
  action: string
  orderType: string
  tif?: string
  totalQuantity?: Decimal
  cashQty?: Decimal
  lmtPrice?: Decimal
  auxPrice?: Decimal
  trailStopPrice?: Decimal
  trailingPercent?: Decimal
  filledQuantity?: Decimal
  outsideRth?: boolean
  parentId?: number
  ocaGroup?: string
  goodTillDate?: string
}

function unsetToUndef(d: Decimal): Decimal | undefined {
  return d.equals(UNSET_DECIMAL) ? undefined : d
}

export const OrderHelper = {
  /** Typed nullable view; sentinel → undefined. */
  read(order: Order): OrderView {
    return {
      action: order.action,
      orderType: order.orderType,
      tif: order.tif || undefined,
      totalQuantity: unsetToUndef(order.totalQuantity),
      cashQty: unsetToUndef(order.cashQty),
      lmtPrice: unsetToUndef(order.lmtPrice),
      auxPrice: unsetToUndef(order.auxPrice),
      trailStopPrice: unsetToUndef(order.trailStopPrice),
      trailingPercent: unsetToUndef(order.trailingPercent),
      filledQuantity: unsetToUndef(order.filledQuantity),
      outsideRth: order.outsideRth || undefined,
      parentId: order.parentId || undefined,
      ocaGroup: order.ocaGroup || undefined,
      goodTillDate: order.goodTillDate || undefined,
    }
  },

  // Accepts Order or Partial<Order> (modifyOrder.changes is the latter).
  toWire(order: Order | Partial<Order>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...order }
    for (const field of SENTINEL_DECIMAL_FIELDS) {
      const v = out[field]
      if (Decimal.isDecimal(v) && v.equals(UNSET_DECIMAL)) {
        delete out[field]
      }
    }
    return out
  },
}
