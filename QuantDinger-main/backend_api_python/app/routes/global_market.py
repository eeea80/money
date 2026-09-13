"""
Global Market Dashboard APIs.

Provides aggregated global market data including:
- Major indices (US, Europe, Japan, Korea, Australia, India)
- Forex pairs
- Crypto prices
- Market heatmap data (crypto, stocks, forex)
- Economic calendar with impact indicators
- Fear & Greed Index / VIX
- Financial news (Chinese & English)

Endpoints:
- GET /api/global-market/overview       - Global market overview
- GET /api/global-market/heatmap        - Market heatmap data
- GET /api/global-market/news           - Financial news (with lang param)
- GET /api/global-market/calendar       - Economic calendar
- GET /api/global-market/sentiment      - Fear & Greed / VIX
- GET /api/global-market/adanos-sentiment - Optional Adanos stock sentiment
- GET /api/global-market/opportunities  - Trading opportunities scanner
"""

from __future__ import annotations

from flask import jsonify, request
from app.openapi.blueprint import HumanBlueprint as Blueprint

from app.utils.logger import get_logger
from app.utils.auth import login_required

# Unified data-provider layer.
#
# Every endpoint below wraps its expensive compute in `cached_or_compute`,
# which gives us three properties for free:
#   1. Cache hit -> 0 upstream calls.
#   2. Cache miss with concurrent callers -> single upstream call (the
#      others block on the per-key lock and then read the populated cache).
#   3. Soft-expired cache -> the previous value is returned IMMEDIATELY
#      and the refresh runs in the background. Users never wait for stale
#      data to become fresh; the next user gets the new value.
#
# These three together are what stops the "open AI asset analysis page,
# wait 2s on yfinance" experience.
from app.data_providers import cached_or_compute, clear_cache, invalidate
from app.data_providers.adanos_sentiment import fetch_adanos_market_sentiment
from app.data_providers.news import fetch_financial_news, get_economic_calendar_payload
from app.data_providers.heatmap import generate_heatmap_data
from app.services.global_market_data import (
    compute_market_overview,
    compute_market_sentiment,
    compute_trading_opportunities,
)

logger = get_logger(__name__)

global_market_blp = Blueprint("global_market", __name__)


# ============ API Endpoints ============

@global_market_blp.route("/overview", methods=["GET"])
@login_required
def market_overview():
    """Get global market overview including indices, forex, crypto, and commodities."""
    try:
        force = request.args.get("force", "").lower() in ("true", "1")
        data = cached_or_compute(
            "market_overview", compute_market_overview, force=force
        )
        return jsonify({"code": 1, "msg": "success", "data": data})
    except Exception as e:
        logger.error("market_overview failed: %s", e, exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@global_market_blp.route("/heatmap", methods=["GET"])
@login_required
def market_heatmap():
    """Get market heatmap data for crypto, stock sectors, forex, and indices."""
    try:
        force = request.args.get("force", "").lower() in ("true", "1")
        data = cached_or_compute(
            "market_heatmap_v4", generate_heatmap_data, force=force
        )
        return jsonify({"code": 1, "msg": "success", "data": data})
    except Exception as e:
        logger.error("market_heatmap failed: %s", e, exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@global_market_blp.route("/news", methods=["GET"])
@login_required
def market_news():
    """Get financial news from various sources.  Query params: lang ('cn'|'en'|'all')."""
    try:
        lang = request.args.get("lang", "all")
        force = request.args.get("force", "").lower() in ("true", "1")
        cache_key = f"market_news_{lang}"
        data = cached_or_compute(
            cache_key,
            lambda: fetch_financial_news(lang),
            ttl=180,
            force=force,
        )
        return jsonify({"code": 1, "msg": "success", "data": data})
    except Exception as e:
        logger.error("market_news failed: %s", e, exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@global_market_blp.route("/calendar", methods=["GET"])
@login_required
def economic_calendar():
    """Get economic calendar events with impact indicators."""
    try:
        force = request.args.get("force", "").lower() in ("true", "1")
        payload = cached_or_compute(
            "economic_calendar_v3", get_economic_calendar_payload, force=force
        )
        if isinstance(payload, list):
            data = payload
            meta = {"status": "ok", "source": "legacy"}
        elif isinstance(payload, dict):
            data = payload.get("events") if isinstance(payload.get("events"), list) else []
            meta = {
                "status": payload.get("status") or "ok",
                "source": payload.get("source") or "free_calendar_sources",
                "config_key": payload.get("config_key") or "",
                "message": payload.get("message") or "",
                "fallback_from": payload.get("fallback_from") or "",
                "fallback_reason": payload.get("fallback_reason") or "",
                "insight_version": "macro_event_context_v1",
            }
        else:
            data = []
            meta = {"status": "error", "source": "free_calendar_sources", "message": "Calendar payload is unavailable."}
        return jsonify({"code": 1, "msg": "success", "data": data, "meta": meta})
    except Exception as e:
        logger.error("economic_calendar failed: %s", e, exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@global_market_blp.route("/sentiment", methods=["GET"])
@login_required
def market_sentiment():
    """Get comprehensive market sentiment indicators."""
    try:
        force = request.args.get("force", "").lower() in ("true", "1")
        data = cached_or_compute(
            "market_sentiment", compute_market_sentiment, force=force
        )
        return jsonify({"code": 1, "msg": "success", "data": data})
    except Exception as e:
        logger.error("market_sentiment failed: %s", e, exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@global_market_blp.route("/adanos-sentiment", methods=["GET"])
@login_required
def adanos_market_sentiment():
    """Get optional Adanos Market Sentiment for selected US stock tickers."""
    try:
        tickers = request.args.get("tickers", "")
        source = request.args.get("source")
        days = int(request.args.get("days") or 7)
        force = request.args.get("force", "").lower() in ("true", "1")
        cache_key = f"adanos_sentiment:{source or 'default'}:{days}:{tickers.upper()}"

        def _compute():
            # Only the *successful* path gets cached. If the upstream is
            # disabled or errored we still surface the response but skip
            # caching by clearing the entry post-hoc.
            data = fetch_adanos_market_sentiment(tickers, source=source, days=days)
            return data

        data = cached_or_compute(cache_key, _compute, ttl=300, force=force)
        # If the freshly-computed result is an "unhealthy" payload, evict
        # the cache so we don't keep returning it for 5 minutes.
        if isinstance(data, dict) and (not data.get("enabled") or data.get("error")):
            invalidate(cache_key)
        return jsonify({"code": 1, "msg": "success", "data": data})

    except ValueError as e:
        return jsonify({"code": 0, "msg": str(e), "data": None}), 400
    except Exception as e:
        logger.error("adanos_market_sentiment failed: %s", e, exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@global_market_blp.route("/opportunities", methods=["GET"])
@login_required
def trading_opportunities():
    """Scan for trading opportunities across Crypto, US/CN/HK Stocks, and Forex."""
    try:
        force = request.args.get("force", "").lower() in ("true", "1")
        data = cached_or_compute(
            "trading_opportunities",
            compute_trading_opportunities,
            force=force,
        )

        # Post-filter against current env flags. Even if a stale cache still
        # holds (or a future scanner accidentally includes) data for a market
        # the operator has disabled in env, the response is guaranteed to be
        # consistent with `/api/market/types`.
        from app.utils.market_visibility import hidden_markets as _hidden
        hidden = _hidden()
        if hidden and isinstance(data, list):
            data = [o for o in data if (o.get("market") if isinstance(o, dict) else None) not in hidden]

        return jsonify({"code": 1, "msg": "success", "data": data or []})
    except Exception as e:
        logger.error("trading_opportunities failed: %s", e, exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@global_market_blp.route("/refresh", methods=["POST"])
@login_required
def refresh_data():
    """Force refresh all market data (clears cache)."""
    try:
        clear_cache()
        return jsonify({"code": 1, "msg": "Cache cleared successfully", "data": None})
    except Exception as e:
        logger.error("refresh_data failed: %s", e, exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500

# openapi-compat: legacy import name
global_market_bp = global_market_blp
