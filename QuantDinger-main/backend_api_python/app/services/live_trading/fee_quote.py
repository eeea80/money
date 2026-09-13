"""Normalize exchange fees into the instrument quote currency."""

from __future__ import annotations

from typing import Any, Mapping, Optional, Tuple

from app.services.live_trading.records import normalize_strategy_symbol


STABLE_QUOTES = {"USD", "USDT", "USDC", "BUSD", "FDUSD", "TUSD"}


def symbol_currencies(symbol: str) -> Tuple[str, str]:
    normalized = normalize_strategy_symbol(symbol)
    if "/" not in normalized:
        return "", ""
    base, quote = normalized.split("/", 1)
    return base.upper(), quote.split(":", 1)[0].upper()


def fee_to_quote(
    client: Any,
    *,
    symbol: str,
    fee: float,
    fee_ccy: str,
    fill_price: float,
) -> Optional[float]:
    raw_amount = float(fee or 0.0)
    sign = -1.0 if raw_amount < 0 else 1.0
    amount = abs(raw_amount)
    if amount <= 0:
        return 0.0
    ccy = str(fee_ccy or "").strip().upper()
    base, quote = symbol_currencies(symbol)
    if not ccy:
        return None
    if not quote and ccy in STABLE_QUOTES:
        return sign * amount
    if ccy == quote or (ccy in STABLE_QUOTES and quote in STABLE_QUOTES):
        return sign * amount
    if ccy == base and float(fill_price or 0.0) > 0:
        return sign * amount * float(fill_price)
    if not quote or not hasattr(client, "get_ticker"):
        return None
    try:
        ticker = client.get_ticker(symbol=f"{ccy}/{quote}")
    except TypeError:
        try:
            ticker = client.get_ticker(f"{ccy}/{quote}")
        except Exception:
            return None
    except Exception:
        return None
    if not isinstance(ticker, Mapping):
        return None
    for key in ("last", "lastPrice", "lastPr", "close", "price"):
        try:
            price = float(ticker.get(key) or 0.0)
        except Exception:
            price = 0.0
        if price > 0:
            return sign * amount * price
    return None
