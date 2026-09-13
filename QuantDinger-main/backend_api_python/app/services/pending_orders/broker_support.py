"""Shared order-type and protection helpers for broker execution paths."""

from __future__ import annotations

import json
from typing import Any, Dict, Tuple

from app.services.live_trading.base import LiveTradingError


def broker_order_type(payload: Dict[str, Any], ref_price: float) -> Tuple[str, float]:
    order_type = str(payload.get("order_type") or "market").strip().lower()
    if order_type == "maker_then_market":
        raise LiveTradingError("maker_then_market is not supported by broker execution")
    if order_type not in ("market", "limit"):
        raise LiveTradingError(f"unsupported_broker_order_type:{order_type}")
    limit_price = float(payload.get("limit_price") or 0.0)
    if order_type == "limit" and limit_price <= 0:
        limit_price = float(ref_price or 0.0)
    if order_type == "limit" and limit_price <= 0:
        raise LiveTradingError("broker_limit_price_required")
    return order_type, limit_price


def broker_protection_prices(
    payload: Dict[str, Any],
    *,
    signal_type: str,
    entry_price: float,
) -> Tuple[float, float]:
    sig = str(signal_type or "").strip().lower()
    if sig not in ("open_long", "add_long", "open_short", "add_short") or entry_price <= 0:
        return 0.0, 0.0
    from app.services.live_trading.native_protection import protection_prices_from_payload

    stop, take, _trailing, _activation = protection_prices_from_payload(
        payload,
        entry_price=float(entry_price),
        pos_side="short" if "short" in sig else "long",
    )
    return float(stop or 0.0), float(take or 0.0)


def redact_exchange_json(value: str) -> str:
    from app.services.live_trading.partner_attribution import redact_partner_attribution

    text_value = str(value or "")
    try:
        parsed = json.loads(text_value or "{}")
    except Exception:
        return str(redact_partner_attribution(text_value))
    return json.dumps(redact_partner_attribution(parsed), ensure_ascii=False)
