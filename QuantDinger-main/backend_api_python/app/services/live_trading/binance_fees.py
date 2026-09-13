"""Validate Binance fill-level commission before calling it authoritative."""

from math import isfinite


def aggregate_commissions(trades, order_id, filled):
    fees = {}
    total_qty = 0.0
    has_qty = False
    for trade in trades:
        if not isinstance(trade, dict):
            continue
        if trade.get("orderId") is not None and str(trade["orderId"]) != str(order_id):
            continue
        try:
            commission = float(trade["commission"])
            currency = str(trade.get("commissionAsset") or "").strip().upper()
            if not isfinite(commission) or (commission != 0 and not currency):
                return {}
            if trade.get("qty") is not None:
                qty = float(trade["qty"])
                if not isfinite(qty) or qty <= 0:
                    return {}
                has_qty = True
                total_qty += qty
        except (KeyError, TypeError, ValueError, OverflowError):
            return {}
        key = currency or "UNKNOWN"
        fees[key] = fees.get(key, 0.0) + abs(commission)
    if has_qty and abs(total_qty - filled) > max(1e-12, abs(filled) * 1e-8):
        return {}
    return fees
