"""Read-class market data endpoints."""
from __future__ import annotations

import math

from app.data.market_symbols_seed import (
    get_hot_symbols as seed_get_hot_symbols,
    search_symbols as seed_search_symbols,
)
from app.services.kline import KlineService
from app.utils.agent_auth import (
    SCOPE_R, agent_required, instrument_allowed, market_allowed,
)
from app.utils.logger import get_logger
from app.utils.market_visibility import is_market_visible
from flask import request

from . import agent_v1_bp
from ._helpers import clip_int, envelope, error

logger = get_logger(__name__)
_kline_service = KlineService()


_MARKETS = [
    {"value": "USStock",  "label": "US Stocks"},
    {"value": "CNStock",  "label": "China A-shares"},
    {"value": "HKStock",  "label": "HK Stocks"},
    {"value": "Crypto",   "label": "Crypto"},
    {"value": "Forex",    "label": "Forex"},
    {"value": "Futures",  "label": "Futures"},
    {"value": "MOEX",     "label": "MOEX"},
]


@agent_v1_bp.route("/markets", methods=["GET"])
@agent_required(SCOPE_R)
def list_markets():
    """List markets the calling token is allowed to query.

    Filtering is the intersection of three rules:
      1. The token's ``markets`` allowlist (set per credential).
      2. Per-deployment visibility (``ENABLED_MARKETS`` / legacy ``SHOW_*``),
         resolved by :func:`app.utils.market_visibility.is_market_visible` so
         the Agent API stays in lock-step with the watchlist picker.
    """
    visible = [
        m for m in _MARKETS
        if market_allowed(m["value"]) and is_market_visible(m["value"])
    ]
    return envelope(visible)


@agent_v1_bp.route("/markets/<market>/symbols", methods=["GET"])
@agent_required(SCOPE_R)
def market_symbols(market: str):
    """Search symbols within a market.

    Query params:
        keyword: substring/code to match (case-insensitive)
        limit:   1..100 (default 20)
    """
    if not market_allowed(market):
        return error(403, f"Market not allowed for this token: {market}", http=403)

    keyword = (request.args.get("keyword") or "").strip().upper()
    limit = clip_int(request.args.get("limit"), default=20, lo=1, hi=100)

    if not keyword:
        out = seed_get_hot_symbols(market=market, limit=limit) or []
    else:
        out = seed_search_symbols(market=market, keyword=keyword, limit=limit) or []
    return envelope(out)


@agent_v1_bp.route("/klines", methods=["GET"])
@agent_required(SCOPE_R)
def klines():
    """OHLCV bars.

    Query params:
        market, symbol     (required)
        timeframe          (default 1D)
        limit              1..2000 (default 300)
        before_time        unix seconds (optional, for backwards pagination)
    """
    market = (request.args.get("market") or "").strip()
    symbol = (request.args.get("symbol") or "").strip()
    timeframe = (request.args.get("timeframe") or "1D").strip()
    limit = clip_int(request.args.get("limit"), default=300, lo=1, hi=2000)
    before_raw = request.args.get("before_time") or request.args.get("beforeTime")

    if not market or not symbol:
        return error(400, "market and symbol are required")
    if not market_allowed(market):
        return error(403, f"Market not allowed: {market}", http=403)
    if not instrument_allowed(symbol):
        return error(403, f"Instrument not allowed: {symbol}", http=403)

    before_time = None
    if before_raw:
        try:
            before_time = int(before_raw)
        except Exception:
            return error(400, "before_time must be unix seconds")

    try:
        rows = _kline_service.get_kline(
            market=market,
            symbol=symbol,
            timeframe=timeframe,
            limit=limit,
            before_time=before_time,
        ) or []
    except Exception as exc:
        logger.error(f"agent_v1/klines failed: {exc}", exc_info=True)
        return error(500, "kline fetch failed", details=str(exc), retriable=True, http=502)

    return envelope({
        "market": market,
        "symbol": symbol,
        "timeframe": timeframe,
        "count": len(rows),
        "klines": rows,
    })


@agent_v1_bp.route("/price", methods=["GET"])
@agent_required(SCOPE_R)
def price():
    """Latest price for a symbol."""
    market = (request.args.get("market") or "").strip()
    symbol = (request.args.get("symbol") or "").strip()
    if not market or not symbol:
        return error(400, "market and symbol are required")
    if not market_allowed(market):
        return error(403, f"Market not allowed: {market}", http=403)
    if not instrument_allowed(symbol):
        return error(403, f"Instrument not allowed: {symbol}", http=403)
    try:
        quote = _kline_service.get_realtime_price(market=market, symbol=symbol) or {}
        close = float(quote.get("price") or 0)
        if not math.isfinite(close) or close <= 0:
            return error(503, "brokerAccounts.quoteUnavailable", retriable=True, http=503)
        source = str(quote.get("source") or "unknown")
        return envelope({
            "market": market,
            "symbol": symbol,
            "price": close,
            "source": source,
            "quote_type": "historical" if source == "kline_1d" else "latest_available",
            "timestamp": quote.get("timestamp"),
            "raw": quote,
        })
    except Exception as exc:
        logger.error(f"agent_v1/price failed: {exc}", exc_info=True)
        return error(500, "price fetch failed", details=str(exc), retriable=True, http=502)
