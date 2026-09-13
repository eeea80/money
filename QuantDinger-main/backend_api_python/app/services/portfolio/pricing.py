"""Portfolio price fetching helpers."""

from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Iterable, Tuple

from app.services.kline import KlineService
from app.utils.logger import get_logger

logger = get_logger(__name__)

_kline_service = KlineService()
_request_interval = 0.3
_request_lock = threading.Lock()
_last_request_time = {}


def portfolio_executor_workers() -> int:
    """Return worker count for portfolio price fetching."""
    try:
        value = int(os.getenv("PORTFOLIO_EXECUTOR_WORKERS", "3"))
        return value if value > 0 else 3
    except Exception:
        return 3


executor = ThreadPoolExecutor(max_workers=portfolio_executor_workers())


def get_single_price(market: str, symbol: str, force_refresh: bool = False) -> dict:
    """Get realtime price data for one symbol with simple per-market throttling."""
    try:
        with _request_lock:
            now = time.time()
            last_time = _last_request_time.get(market, 0)
            wait_time = _request_interval - (now - last_time)
            if wait_time > 0:
                time.sleep(wait_time)
            _last_request_time[market] = time.time()

        price_data = _kline_service.get_realtime_price(
            market,
            symbol,
            force_refresh=force_refresh,
        )

        return {
            "market": market,
            "symbol": symbol,
            "price": price_data.get("price", 0),
            "change": price_data.get("change", 0),
            "changePercent": price_data.get("changePercent", 0),
            "source": price_data.get("source", "unknown"),
        }
    except Exception as exc:
        logger.error("Failed to fetch price %s:%s - %s", market, symbol, exc)
        return {
            "market": market,
            "symbol": symbol,
            "price": 0,
            "change": 0,
            "changePercent": 0,
            "source": "error",
        }


def fetch_price_map(
    market_symbols: Iterable[Tuple[str, str]],
    *,
    force_refresh: bool = False,
    timeout: float = 10,
) -> Dict[str, dict]:
    """Fetch unique market/symbol prices in parallel and return a keyed map."""
    futures = {}
    for market, symbol in market_symbols:
        if not market or not symbol:
            continue
        key = f"{market}:{symbol}"
        if key not in futures:
            futures[key] = executor.submit(get_single_price, market, symbol, force_refresh)

    price_map: Dict[str, dict] = {}
    for key, future in futures.items():
        try:
            price_map[key] = future.result(timeout=timeout)
        except Exception as exc:
            logger.warning("Price fetch failed for %s: %s", key, exc)
    return price_map
