"""Free, best-effort Hong Kong research data adapters.

The professional report consumes normalized dictionaries only.  This module
keeps AkShare/Eastmoney/ET Net and HKMA response shapes out of the report
contract, applies a short deadline, and never fabricates a neutral value when
an upstream source is unavailable.
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError
from datetime import datetime, timezone
from statistics import median
from typing import Any, Callable

import requests

from app.data_providers import get_cached, set_cached
from app.utils.logger import get_logger


logger = get_logger(__name__)

_CACHE_TTL_SECONDS = 21_600
_HKMA_HIBOR_URL = (
    "https://api.hkma.gov.hk/public/market-data-and-statistics/"
    "monthly-statistical-bulletin/er-ir/hk-interbank-ir-daily"
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _code(symbol: str) -> str:
    digits = "".join(ch for ch in str(symbol or "").split(".")[0] if ch.isdigit())
    return digits.zfill(5)[-5:]


def _value(value: Any) -> Any:
    """Convert pandas/numpy scalars to JSON-safe Python values."""
    if value is None:
        return None
    try:
        if bool(value != value):  # NaN / NaT
            return None
    except Exception:
        pass
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return value


def _number(value: Any) -> float | None:
    value = _value(value)
    if value is None or value == "":
        return None
    try:
        number = float(str(value).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _text(value: Any) -> str | None:
    value = _value(value)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _latest_frame_row(frame: Any, date_column: str | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    if frame is None or getattr(frame, "empty", True):
        return {}, {}
    working = frame.copy()
    if date_column and date_column in working.columns:
        try:
            working = working.sort_values(date_column)
        except Exception:
            pass
    latest = {str(key): _value(value) for key, value in working.iloc[-1].to_dict().items()}
    previous = (
        {str(key): _value(value) for key, value in working.iloc[-2].to_dict().items()}
        if len(working) > 1 else {}
    )
    return latest, previous


def fetch_hk_security_profile(symbol: str, *, ak_client: Any = None) -> dict[str, Any]:
    if ak_client is None:
        import akshare as ak_client
    code = _code(symbol)
    frame = ak_client.stock_hk_security_profile_em(symbol=code)
    row, _ = _latest_frame_row(frame)
    if not row:
        return {}
    security_type = _text(row.get("证券类型"))
    return {
        "symbol": code,
        "security_type": security_type,
        "is_h_share": security_type == "H股",
        "southbound_eligible_sh": _text(row.get("是否沪港通标的")) == "是",
        "southbound_eligible_sz": _text(row.get("是否深港通标的")) == "是",
        "listing_date": _text(row.get("上市日期")),
        "isin": _text(row.get("ISIN（国际证券识别编码）")),
        "source": "eastmoney_hk_via_akshare",
        "source_url": (
            "https://emweb.securities.eastmoney.com/PC_HKF10/pages/home/"
            f"index.html?code={code}&type=web"
        ),
        "as_of": _utc_now(),
    }


def fetch_hk_southbound_holdings(symbol: str, *, ak_client: Any = None) -> dict[str, Any]:
    """Return Stock Connect holdings change, explicitly labelled as a flow proxy."""
    if ak_client is None:
        import akshare as ak_client
    code = _code(symbol)
    frame = ak_client.stock_hsgt_individual_em(symbol=code)
    latest, previous = _latest_frame_row(frame, "持股日期")
    if not latest:
        return {}
    shares = _number(latest.get("持股数量"))
    previous_shares = _number(previous.get("持股数量"))
    change = shares - previous_shares if shares is not None and previous_shares is not None else None
    change_pct = (
        change / previous_shares * 100
        if change is not None and previous_shares not in (None, 0)
        else None
    )
    return {
        "date": _text(latest.get("持股日期")),
        "holding_shares": shares,
        "holding_market_value_hkd": _number(latest.get("持股市值")),
        "holding_ratio_pct": _number(latest.get("持股数量占A股百分比")),
        "holding_change_shares_1d": change,
        "holding_change_pct_1d": change_pct,
        "scope": "stock_connect_holdings_change_proxy",
        "source": "eastmoney_hsgt_via_akshare",
        "source_url": f"https://data.eastmoney.com/hsgt/StockHdDetail/{code}.html",
        "as_of": _text(latest.get("持股日期")) or _utc_now(),
    }


def fetch_hk_analyst_expectations(symbol: str, *, ak_client: Any = None) -> dict[str, Any]:
    if ak_client is None:
        import akshare as ak_client
    code = _code(symbol)
    rating_frame = ak_client.stock_hk_profit_forecast_et(symbol=code, indicator="评级总览")
    forecast_frame = ak_client.stock_hk_profit_forecast_et(symbol=code, indicator="盈利预测概览")
    rating, _ = _latest_frame_row(rating_frame)
    rows = []
    if forecast_frame is not None and not getattr(forecast_frame, "empty", True):
        rows = [
            {str(key): _value(value) for key, value in row.items()}
            for row in forecast_frame.to_dict(orient="records")
        ]
    dated_rows = [row for row in rows if _text(row.get("更新日期"))]
    latest_date = max((_text(row.get("更新日期")) for row in dated_rows), default=None)
    targets = [_number(row.get("目标价")) for row in rows]
    targets = [item for item in targets if item is not None and item > 0]
    brokers = {_text(row.get("证券商")) for row in rows if _text(row.get("证券商"))}
    if not rating and not rows:
        return {}
    return {
        "rating_direction": _text(rating.get("方向")),
        "rating_summary": _text(rating.get("评级数量")),
        "average_rating": _number(rating.get("平均评级")),
        "analyst_count": len(brokers) or None,
        "target_price_median_hkd": median(targets) if targets else None,
        "target_price_low_hkd": min(targets) if targets else None,
        "target_price_high_hkd": max(targets) if targets else None,
        "latest_update": latest_date,
        "scope": "broker_consensus_snapshot",
        "source": "etnet_hk_via_akshare",
        "source_url": f"https://www.etnet.com.hk/www/sc/stocks/realtime/quote_profit.php?code={int(code)}",
        "as_of": latest_date or _utc_now(),
    }


def fetch_hkma_hibor(*, http_get: Callable[..., Any] = requests.get, timeout: float = 6.0) -> dict[str, Any]:
    response = http_get(
        _HKMA_HIBOR_URL,
        params={"segment": "hibor.fixing", "offset": 0},
        timeout=timeout,
    )
    response.raise_for_status()
    payload = response.json() or {}
    records = ((payload.get("result") or {}).get("records") or [])
    if not records:
        return {}
    records = sorted(records, key=lambda item: str(item.get("end_of_day") or ""))
    latest = records[-1]
    return {
        "end_of_day": _text(latest.get("end_of_day")),
        "overnight_pct": _number(latest.get("ir_overnight")),
        "one_month_pct": _number(latest.get("ir_1m")),
        "three_month_pct": _number(latest.get("ir_3m")),
        "twelve_month_pct": _number(latest.get("ir_12m")),
        "source": "hkma_open_api",
        "source_url": _HKMA_HIBOR_URL + "?segment=hibor.fixing",
        "as_of": _text(latest.get("end_of_day")) or _utc_now(),
    }


def collect_hk_research(
    symbol: str,
    *,
    timeout: float | None = None,
    ak_client: Any = None,
    http_get: Callable[..., Any] = requests.get,
) -> dict[str, Any]:
    """Collect independent HK enrichments within one bounded deadline."""
    code = _code(symbol)
    cache_key = f"hk_research:{code}"
    cached = get_cached(cache_key)
    if isinstance(cached, dict):
        return cached

    # Keep the community path zero-configuration.  The caller can still pass a
    # shorter deadline in tests or latency-sensitive workflows.
    deadline = float(timeout or 12)
    jobs: dict[str, Callable[[], dict[str, Any]]] = {
        "hk_security_profile": lambda: fetch_hk_security_profile(code, ak_client=ak_client),
        "southbound_flow": lambda: fetch_hk_southbound_holdings(code, ak_client=ak_client),
        "analyst_expectations": lambda: fetch_hk_analyst_expectations(code, ak_client=ak_client),
        "hk_macro": lambda: fetch_hkma_hibor(http_get=http_get, timeout=min(6.0, deadline)),
    }
    executor = ThreadPoolExecutor(max_workers=len(jobs), thread_name_prefix="hk-research")
    futures = {executor.submit(job): key for key, job in jobs.items()}
    result: dict[str, Any] = {}
    errors: dict[str, str] = {}
    try:
        for future in as_completed(futures, timeout=deadline):
            key = futures[future]
            try:
                value = future.result()
                if value:
                    result[key] = value
            except Exception as exc:
                errors[key] = f"{type(exc).__name__}: {exc}"
                logger.info("HK research source unavailable for %s/%s: %s", code, key, exc)
    except TimeoutError:
        for future, key in futures.items():
            if not future.done():
                errors[key] = "timeout"
                future.cancel()
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    result["_provider_status"] = {
        "attempted": sorted(jobs),
        "available": sorted(key for key in jobs if result.get(key)),
        "unavailable": sorted(key for key in jobs if not result.get(key)),
        "errors": errors,
        "collected_at": _utc_now(),
    }
    # Cache only useful results. A total outage should be retried on the next report.
    if any(result.get(key) for key in jobs):
        set_cached(cache_key, result, _CACHE_TTL_SECONDS)
    return result


__all__ = [
    "collect_hk_research",
    "fetch_hk_analyst_expectations",
    "fetch_hk_security_profile",
    "fetch_hk_southbound_holdings",
    "fetch_hkma_hibor",
]
