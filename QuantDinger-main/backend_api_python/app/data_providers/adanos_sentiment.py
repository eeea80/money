"""Optional Adanos Market Sentiment provider for US stock tickers."""
from __future__ import annotations

import math
import os
import re
from typing import Any, Dict, Iterable, List, Optional

import requests

from app.config import APIKeys
from app.utils.logger import get_logger

logger = get_logger(__name__)

DEFAULT_BASE_URL = "https://api.adanos.org"
DEFAULT_SOURCE = "reddit"
DEFAULT_DAYS = 7
DEFAULT_TIMEOUT = 10
MAX_TICKERS = 20

SUPPORTED_SOURCES = {
    "reddit": "reddit/stocks/v1",
    "x": "x/stocks/v1",
    "news": "news/stocks/v1",
    "polymarket": "polymarket/stocks/v1",
}

_TICKER_RE = re.compile(r"^\$?[A-Z][A-Z0-9.]{0,9}$")


def parse_tickers(value: str | Iterable[str] | None) -> List[str]:
    """Normalize comma-separated or iterable stock ticker input."""
    if value is None:
        return []

    raw_values = value.split(",") if isinstance(value, str) else list(value)
    tickers: List[str] = []
    seen = set()

    for raw in raw_values:
        ticker = str(raw or "").strip().replace("$", "").upper()
        if not ticker or not _TICKER_RE.match(ticker):
            continue
        if ticker not in seen:
            tickers.append(ticker)
            seen.add(ticker)
        if len(tickers) >= MAX_TICKERS:
            break

    return tickers


def normalize_source(source: Optional[str]) -> str:
    """Return a supported Adanos source name."""
    normalized = (source or os.getenv("ADANOS_SENTIMENT_SOURCE") or DEFAULT_SOURCE).strip().lower()
    if normalized == "twitter":
        normalized = "x"
    if normalized not in SUPPORTED_SOURCES:
        raise ValueError(f"Unsupported Adanos sentiment source: {normalized!r}")
    return normalized


def _to_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _to_int(value: Any) -> Optional[int]:
    number = _to_float(value)
    return int(number) if number is not None else None


def _pick(record: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in record:
            return record.get(key)
    return None


def _rows(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = payload.get("stocks") or payload.get("data") or payload.get("results") or []
    else:
        rows = []
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _normalize_record(record: Dict[str, Any], source: str) -> Optional[Dict[str, Any]]:
    ticker = str(record.get("ticker") or record.get("symbol") or "").strip().replace("$", "").upper()
    if not ticker:
        return None

    return {
        "ticker": ticker,
        "company_name": _pick(record, "company_name", "name", "company"),
        "source": source,
        "sentiment_score": _to_float(_pick(record, "sentiment_score", "sentiment", "score")),
        "buzz_score": _to_float(_pick(record, "buzz_score", "buzz")),
        "bullish_pct": _to_float(record.get("bullish_pct")),
        "bearish_pct": _to_float(record.get("bearish_pct")),
        "mentions": _to_int(_pick(record, "mentions", "mention_count")),
        "source_count": _to_int(record.get("source_count")),
        "subreddit_count": _to_int(record.get("subreddit_count")),
        "unique_posts": _to_int(record.get("unique_posts")),
        "unique_tweets": _to_int(record.get("unique_tweets")),
        "trade_count": _to_int(record.get("trade_count")),
        "market_count": _to_int(record.get("market_count")),
        "unique_traders": _to_int(record.get("unique_traders")),
        "total_upvotes": _to_int(_pick(record, "total_upvotes", "upvotes")),
        "total_liquidity": _to_float(record.get("total_liquidity")),
        "trend": record.get("trend"),
        "trend_history": record.get("trend_history") if isinstance(record.get("trend_history"), list) else [],
    }


def _api_base_url() -> str:
    return (os.getenv("ADANOS_API_BASE_URL") or DEFAULT_BASE_URL).strip().rstrip("/")


def _timeout() -> int:
    try:
        return max(1, int(os.getenv("ADANOS_API_TIMEOUT", str(DEFAULT_TIMEOUT))))
    except ValueError:
        return DEFAULT_TIMEOUT


def fetch_adanos_market_sentiment(
    tickers: str | Iterable[str] | None,
    *,
    source: Optional[str] = None,
    days: int = DEFAULT_DAYS,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout: Optional[int] = None,
    session: Any = requests,
) -> Dict[str, Any]:
    """Fetch optional Adanos Market Sentiment snapshots.

    This provider is intentionally fail-open: if no API key is configured, it
    returns ``enabled=false`` instead of raising. That keeps QuantDinger fully
    usable without Adanos.
    """
    parsed_tickers = parse_tickers(tickers)
    selected_source = normalize_source(source)
    selected_days = max(1, min(int(days or DEFAULT_DAYS), 365))

    result = {
        "enabled": False,
        "provider": "adanos",
        "source": selected_source,
        "days": selected_days,
        "tickers": parsed_tickers,
        "stocks": [],
        "error": None,
    }

    if not parsed_tickers:
        result["error"] = "No valid stock tickers provided"
        return result

    selected_key = str(api_key if api_key is not None else APIKeys.ADANOS_API_KEY).strip()
    if not selected_key:
        result["error"] = "ADANOS_API_KEY is not configured"
        return result

    result["enabled"] = True
    endpoint = f"{(base_url or _api_base_url()).rstrip('/')}/{SUPPORTED_SOURCES[selected_source]}/compare"

    try:
        response = session.get(
            endpoint,
            params={"tickers": ",".join(parsed_tickers), "days": selected_days},
            headers={"Accept": "application/json", "X-API-Key": selected_key},
            timeout=timeout or _timeout(),
        )
    except requests.RequestException as exc:
        logger.warning("Adanos sentiment request failed: %s", exc)
        result["error"] = str(exc)
        return result

    if response.status_code != 200:
        result["error"] = f"Adanos API returned HTTP {response.status_code}"
        return result

    try:
        payload = response.json()
    except ValueError:
        result["error"] = "Adanos API returned invalid JSON"
        return result

    result["stocks"] = [
        normalized
        for normalized in (_normalize_record(record, selected_source) for record in _rows(payload))
        if normalized is not None
    ]
    return result
