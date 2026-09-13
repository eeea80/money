"""Free, best-effort US equity research adapters.

The report layer consumes stable, source-labelled dictionaries.  This module
keeps SEC EDGAR and Yahoo response shapes out of the contract and explicitly
labels proxies such as Form 4 filing activity and nearest-expiry option data.
No API key is required.
"""

from __future__ import annotations

import math
import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError, as_completed
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

import requests

from app.data_providers import get_cached, set_cached
from app.utils.logger import get_logger


logger = get_logger(__name__)

_CACHE_TTL_SECONDS = 10_800
_SEC_TICKERS_TTL_SECONDS = 86_400
_SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
_SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
_SEC_USER_AGENT = os.getenv(
    "SEC_USER_AGENT",
    "QuantDinger/5.0 open-source-research support@quantdinger.com",
).strip()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _symbol(value: str) -> str:
    return str(value or "").strip().upper().replace(".", "-")


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(str(value).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _timestamp(value: Any) -> str | None:
    number = _number(value)
    if number is None or number <= 0:
        return None
    # Yahoo timestamps are seconds; tolerate millisecond inputs from fixtures.
    if number > 10_000_000_000:
        number /= 1000
    try:
        return datetime.fromtimestamp(number, timezone.utc).isoformat().replace("+00:00", "Z")
    except (ValueError, OSError, OverflowError):
        return None


def _request_json(
    url: str,
    *,
    http_get: Callable[..., Any],
    timeout: float,
) -> Any:
    response = http_get(
        url,
        headers={"User-Agent": _SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate"},
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()


def _sec_ticker_map(*, http_get: Callable[..., Any], timeout: float) -> dict[str, dict[str, Any]]:
    cache_key = "sec_edgar:ticker_cik:v1"
    cached = get_cached(cache_key, _SEC_TICKERS_TTL_SECONDS)
    if isinstance(cached, dict) and cached:
        return cached
    payload = _request_json(_SEC_TICKERS_URL, http_get=http_get, timeout=timeout) or {}
    rows = payload.values() if isinstance(payload, Mapping) else payload
    result: dict[str, dict[str, Any]] = {}
    for row in rows or []:
        if not isinstance(row, Mapping):
            continue
        ticker = _symbol(str(row.get("ticker") or ""))
        try:
            cik = int(row.get("cik_str"))
        except (TypeError, ValueError):
            continue
        if ticker:
            result[ticker] = {"cik": cik, "title": str(row.get("title") or "").strip()}
    if result:
        set_cached(cache_key, result, _SEC_TICKERS_TTL_SECONDS)
    return result


def fetch_sec_research(
    symbol: str,
    *,
    http_get: Callable[..., Any] = requests.get,
    timeout: float = 6.0,
) -> dict[str, Any]:
    """Fetch recent issuer filings and Form 4 filing activity from EDGAR."""
    ticker = _symbol(symbol)
    company = _sec_ticker_map(http_get=http_get, timeout=timeout).get(ticker)
    if not company:
        return {}
    cik = int(company["cik"])
    cik_padded = f"{cik:010d}"
    payload = _request_json(
        _SEC_SUBMISSIONS_URL.format(cik=cik_padded),
        http_get=http_get,
        timeout=timeout,
    ) or {}
    recent = ((payload.get("filings") or {}).get("recent") or {})
    forms = list(recent.get("form") or [])
    filings: list[dict[str, Any]] = []
    form4_dates: list[str] = []
    relevant_forms = {"10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "20-F", "6-K"}
    for index, form in enumerate(forms):
        filing_date = _at(recent.get("filingDate"), index)
        accession = str(_at(recent.get("accessionNumber"), index) or "").strip()
        primary_document = str(_at(recent.get("primaryDocument"), index) or "").strip()
        if str(form).upper() in {"4", "4/A"} and filing_date:
            form4_dates.append(str(filing_date))
        if str(form).upper() not in relevant_forms or len(filings) >= 12:
            continue
        accession_path = accession.replace("-", "")
        filing_url = (
            f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession_path}/{primary_document}"
            if accession_path and primary_document else
            f"https://www.sec.gov/edgar/browse/?CIK={cik_padded}"
        )
        filings.append({
            "form": str(form),
            "filing_date": filing_date,
            "report_date": _at(recent.get("reportDate"), index),
            "accession_number": accession or None,
            "description": _at(recent.get("primaryDocDescription"), index),
            "source": "sec_edgar",
            "url": filing_url,
            "as_of": filing_date,
        })
    insider = {}
    if form4_dates:
        insider = {
            "recent_form4_filing_count": len(form4_dates[:20]),
            "latest_form4_filing_date": max(form4_dates),
            "scope": "form4_filing_activity_not_trade_direction",
            "source": "sec_edgar",
            "source_url": f"https://www.sec.gov/edgar/browse/?CIK={cik_padded}&owner=include",
            "as_of": max(form4_dates),
        }
    return {
        "sec_filings": filings,
        "insider_activity": insider,
        "identity": {
            "ticker": ticker,
            "cik": cik_padded,
            "company_name": payload.get("name") or company.get("title"),
        },
    }


def _at(values: Any, index: int) -> Any:
    try:
        return values[index]
    except (TypeError, IndexError, KeyError):
        return None


def _frame_total(frame: Any, column: str) -> float | None:
    if frame is None or getattr(frame, "empty", True) or column not in frame.columns:
        return None
    try:
        values = frame[column].fillna(0)
        return float(values.sum())
    except Exception:
        return None


def _nearest_atm_iv(calls: Any, puts: Any, spot: float | None) -> float | None:
    if spot is None:
        return None
    candidates: list[tuple[float, float]] = []
    for frame in (calls, puts):
        if frame is None or getattr(frame, "empty", True):
            continue
        if "strike" not in frame.columns or "impliedVolatility" not in frame.columns:
            continue
        for _, row in frame.iterrows():
            strike = _number(row.get("strike"))
            iv = _number(row.get("impliedVolatility"))
            # Yahoo may expose 0.00001 as a missing/placeholder IV.  Treat
            # implausibly small or malformed values as unavailable rather than
            # presenting them as a real 0.0% volatility observation.
            if strike is not None and iv is not None and 0.001 <= iv <= 10:
                candidates.append((abs(strike - spot), iv))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    nearest = [iv for distance, iv in candidates if distance == candidates[0][0]]
    return sum(nearest) / len(nearest) * 100


def fetch_yahoo_us_research(symbol: str, *, yf_client: Any = None) -> dict[str, Any]:
    """Fetch a compact analyst, options and short-interest snapshot."""
    if yf_client is None:
        import yfinance as yf_client
    ticker_symbol = _symbol(symbol)
    ticker = yf_client.Ticker(ticker_symbol)
    info = ticker.info or {}
    source_url = f"https://finance.yahoo.com/quote/{ticker_symbol}"
    as_of = _utc_now()

    expectations = {
        "rating_direction": info.get("recommendationKey"),
        "recommendation_mean": _number(info.get("recommendationMean")),
        "analyst_count": _number(info.get("numberOfAnalystOpinions")),
        "target_price_median_usd": _number(info.get("targetMedianPrice")),
        "target_price_mean_usd": _number(info.get("targetMeanPrice")),
        "target_price_low_usd": _number(info.get("targetLowPrice")),
        "target_price_high_usd": _number(info.get("targetHighPrice")),
        "scope": "provider_consensus_snapshot",
        "source": "yahoo_finance",
        "source_url": f"{source_url}/analysis",
        "as_of": as_of,
    }
    expectations = _compact(expectations, keep={"scope", "source", "source_url", "as_of"})

    short_interest = {
        "shares_short": _number(info.get("sharesShort")),
        "short_ratio_days": _number(info.get("shortRatio")),
        "short_percent_of_float_pct": (
            _number(info.get("shortPercentOfFloat")) * 100
            if _number(info.get("shortPercentOfFloat")) is not None else None
        ),
        "shares_short_prior_month": _number(info.get("sharesShortPriorMonth")),
        "settlement_date": _timestamp(info.get("dateShortInterest")),
        "scope": "reported_short_interest_not_daily_short_volume",
        "source": "yahoo_finance",
        "source_url": f"{source_url}/key-statistics",
        "as_of": _timestamp(info.get("dateShortInterest")) or as_of,
    }
    short_interest = _compact(short_interest, keep={"scope", "source", "source_url", "as_of"})

    options: dict[str, Any] = {}
    expiries = list(getattr(ticker, "options", ()) or ())
    if expiries:
        expiry = str(expiries[0])
        chain = ticker.option_chain(expiry)
        calls = getattr(chain, "calls", None)
        puts = getattr(chain, "puts", None)
        call_volume = _frame_total(calls, "volume")
        put_volume = _frame_total(puts, "volume")
        call_oi = _frame_total(calls, "openInterest")
        put_oi = _frame_total(puts, "openInterest")
        spot = _number(info.get("currentPrice") or info.get("regularMarketPrice"))
        options = _compact({
            "expiry": expiry,
            "call_volume": call_volume,
            "put_volume": put_volume,
            "put_call_volume_ratio": put_volume / call_volume if put_volume is not None and call_volume else None,
            "call_open_interest": call_oi,
            "put_open_interest": put_oi,
            "put_call_open_interest_ratio": put_oi / call_oi if put_oi is not None and call_oi else None,
            "nearest_atm_implied_volatility_pct": _nearest_atm_iv(calls, puts, spot),
            "scope": "nearest_expiry_snapshot",
            "source": "yahoo_finance",
            "source_url": f"{source_url}/options",
            "as_of": as_of,
        }, keep={"scope", "source", "source_url", "as_of", "expiry"})

    return {
        "analyst_expectations": expectations if _has_measurement(expectations) else {},
        "options": options if _has_measurement(options) else {},
        "short_interest": short_interest if _has_measurement(short_interest) else {},
    }


def _compact(value: Mapping[str, Any], *, keep: set[str]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if key in keep or item is not None}


def _has_measurement(value: Mapping[str, Any]) -> bool:
    metadata = {"scope", "source", "source_url", "as_of", "expiry"}
    return any(item is not None and item != "" for key, item in value.items() if key not in metadata)


def collect_us_research(
    symbol: str,
    *,
    timeout: float | None = None,
    http_get: Callable[..., Any] = requests.get,
    yf_client: Any = None,
) -> dict[str, Any]:
    ticker = _symbol(symbol)
    # Bump when normalized semantics change so an upgrade never serves an old
    # snapshot with values that the current contract would reject.
    cache_key = f"us_research:{ticker}:v2"
    cached = get_cached(cache_key, _CACHE_TTL_SECONDS)
    if isinstance(cached, dict):
        return cached
    deadline = float(timeout or 12)
    jobs: dict[str, Callable[[], dict[str, Any]]] = {
        "sec_edgar": lambda: fetch_sec_research(ticker, http_get=http_get, timeout=min(6.0, deadline)),
        "yahoo_research": lambda: fetch_yahoo_us_research(ticker, yf_client=yf_client),
    }
    executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="us-research")
    futures = {executor.submit(job): key for key, job in jobs.items()}
    result: dict[str, Any] = {}
    errors: dict[str, str] = {}
    try:
        for future in as_completed(futures, timeout=deadline):
            key = futures[future]
            try:
                payload = future.result() or {}
                for payload_key, value in payload.items():
                    if value and payload_key != "identity":
                        result[payload_key] = value
                if payload.get("identity"):
                    result["sec_identity"] = payload["identity"]
            except Exception as exc:
                errors[key] = f"{type(exc).__name__}: {exc}"
                logger.info("US research source unavailable for %s/%s: %s", ticker, key, exc)
    except TimeoutError:
        for future, key in futures.items():
            if not future.done():
                errors[key] = "timeout"
                future.cancel()
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
    available = [key for key in ("sec_filings", "insider_activity", "analyst_expectations", "options", "short_interest") if result.get(key)]
    result["_provider_status"] = {
        "attempted": sorted(jobs),
        "available": available,
        "unavailable": sorted(set(("sec_filings", "insider_activity", "analyst_expectations", "options", "short_interest")) - set(available)),
        "errors": errors,
        "collected_at": _utc_now(),
    }
    if available:
        set_cached(cache_key, result, _CACHE_TTL_SECONDS)
    return result


__all__ = ["collect_us_research", "fetch_sec_research", "fetch_yahoo_us_research"]
