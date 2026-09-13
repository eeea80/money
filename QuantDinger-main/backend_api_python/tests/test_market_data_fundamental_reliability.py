import copy
import re
import threading

import pytest

from app.services.fast_analysis import FastAnalysisService
from app.services.market_data_collector import MarketDataCollector


def test_fundamental_fetch_is_cached_across_timeframes(monkeypatch):
    collector = MarketDataCollector.__new__(MarketDataCollector)
    collector._fundamental_cache = {}
    collector._fundamental_cache_lock = threading.RLock()
    calls = []
    payload = {
        "source": "test",
        "financial_statements": {"latest_quarter": {"period_end": "2026-06-30"}},
    }

    def fetch(market, symbol):
        calls.append((market, symbol))
        return copy.deepcopy(payload)

    collector._fetch_fundamental_uncached = fetch
    collector._load_persisted_fundamental = lambda *_args: None
    collector._persist_fundamental_payload = lambda *_args: None

    first = collector._get_fundamental("USStock", "spcx")
    first["source"] = "mutated-by-caller"
    second = collector._get_fundamental("USStock", "SPCX")

    assert calls == [("USStock", "SPCX")]
    assert second["source"] == payload["source"]
    assert second["financial_statements"] == payload["financial_statements"]
    assert second["data_quality"]["storage"]["served_from"] == "provider_refresh"


def test_fundamental_uses_fresh_persisted_provider_payload_without_network():
    collector = MarketDataCollector.__new__(MarketDataCollector)
    collector._fundamental_cache = {}
    collector._fundamental_cache_lock = threading.RLock()
    local = {
        "source": "yfinance",
        "market_cap": 3_000_000_000_000,
        "financial_statements": {"latest_quarter": {"period_end": "2026-06-30"}},
        "earnings": {"history": [{"date": "2026-06-30", "eps_actual": 1.5}]},
    }
    collector._load_persisted_fundamental = lambda *_args: {
        "payload": copy.deepcopy(local),
        "fresh": True,
        "has_provider_payload": True,
    }
    collector._fetch_fundamental_uncached = lambda *_args: (_ for _ in ()).throw(
        AssertionError("fresh persisted payload must avoid provider IO")
    )

    result = collector._get_fundamental("USStock", "AAPL")

    assert result["market_cap"] == local["market_cap"]
    assert result["financial_statements"] == local["financial_statements"]
    assert result["data_quality"]["storage"]["served_from"] == "database"


def test_recently_checked_old_report_does_not_repeat_provider_request():
    collector = MarketDataCollector.__new__(MarketDataCollector)
    collector._fundamental_cache = {}
    collector._fundamental_cache_lock = threading.RLock()
    collector._load_persisted_fundamental = lambda *_args: {
        "payload": {"source": "yfinance_hk", "market_cap": 1000.0},
        "fresh": False,
        "has_provider_payload": True,
        "stale_reasons": ["report_age"],
        "refresh_required": False,
    }
    provider_calls = []
    collector._fetch_fundamental_uncached = lambda *args: provider_calls.append(args)

    result = collector._get_fundamental("HKStock", "00003")

    assert provider_calls == []
    assert result["data_quality"]["storage"]["served_from"] == "database"


def test_fundamental_refreshes_incomplete_snapshot_and_writes_merged_payload():
    collector = MarketDataCollector.__new__(MarketDataCollector)
    collector._fundamental_cache = {}
    collector._fundamental_cache_lock = threading.RLock()
    collector._load_persisted_fundamental = lambda *_args: {
        "payload": {"source": "yfinance_quarterly", "revenue": 100.0, "net_income": 20.0},
        "fresh": True,
        "has_provider_payload": False,
    }
    collector._fetch_fundamental_uncached = lambda *_args: {
        "source": "yfinance",
        "market_cap": 1_000.0,
        "financial_statements": {"latest_quarter": {"period_end": "2026-06-30"}},
        "earnings": {"history": []},
    }
    persisted = []
    collector._persist_fundamental_payload = lambda market, symbol, payload: persisted.append(
        (market, symbol, copy.deepcopy(payload))
    )

    result = collector._get_fundamental("USStock", "AAPL")

    assert result["revenue"] == 100.0
    assert result["net_income"] == 20.0
    assert result["market_cap"] == 1_000.0
    assert result["financial_statements"]["latest_quarter"]["period_end"] == "2026-06-30"
    assert persisted[0][0:2] == ("USStock", "AAPL")
    assert persisted[0][2]["market_cap"] == 1_000.0
    assert result["data_quality"]["storage"]["served_from"] == "provider_refresh"
    assert result["data_quality"]["storage"]["writeback"] == "success"


def test_fundamental_falls_back_to_stale_snapshot_when_provider_fails():
    collector = MarketDataCollector.__new__(MarketDataCollector)
    collector._fundamental_cache = {}
    collector._fundamental_cache_lock = threading.RLock()
    collector._load_persisted_fundamental = lambda *_args: {
        "payload": {"source": "local", "market_cap": 500.0},
        "fresh": False,
        "has_provider_payload": True,
    }
    collector._fetch_fundamental_uncached = lambda *_args: None

    result = collector._get_fundamental("USStock", "AAPL")

    assert result["market_cap"] == 500.0
    assert result["data_quality"]["storage"]["served_from"] == "database_fallback"
    assert result["data_quality"]["storage"]["refresh_failed"] is True


def test_fundamental_provider_result_survives_writeback_failure():
    collector = MarketDataCollector.__new__(MarketDataCollector)
    collector._fundamental_cache = {}
    collector._fundamental_cache_lock = threading.RLock()
    collector._load_persisted_fundamental = lambda *_args: None
    collector._fetch_fundamental_uncached = lambda *_args: {"source": "provider", "market_cap": 750.0}
    collector._persist_fundamental_payload = lambda *_args: (_ for _ in ()).throw(RuntimeError("db down"))

    result = collector._get_fundamental("USStock", "AAPL")

    assert result["market_cap"] == 750.0
    assert result["data_quality"]["storage"]["writeback"] == "failed"


def test_hk_yfinance_fills_missing_canonical_and_extended_fields(monkeypatch):
    collector = MarketDataCollector.__new__(MarketDataCollector)

    class FakeTicker:
        info = {
            "symbol": "0700.HK",
            "currency": "HKD",
            "marketCap": 3_900_000_000_000,
            "totalRevenue": 788_000_000_000,
            "netIncomeToCommon": 235_000_000_000,
            "bookValue": 147.5,
            "totalDebt": 471_000_000_000,
            "freeCashflow": 118_000_000_000,
            "sharesOutstanding": 9_000_000_000,
            "returnOnEquity": 0.199,
            "revenueGrowth": 0.11,
            "debtToEquity": 38.5,
        }

    monkeypatch.setattr("app.services.market_data_collector.yf.Ticker", lambda _symbol: FakeTicker())
    monkeypatch.setattr(
        collector,
        "_get_financial_statements",
        lambda *_args, **_kwargs: {"latest_quarter": {"period_end": "2026-06-30"}},
    )
    monkeypatch.setattr(
        collector,
        "_get_earnings_data",
        lambda *_args, **_kwargs: {"history": [{"date": "2026-06-30", "eps_actual": 3.2}]},
    )
    result = {"source": "tencent_quote+akshare_em", "market_cap": 4_000_000_000_000}

    collector._enrich_hk_fundamental_with_yfinance(result, "HK00700")

    assert result["market_cap"] == 4_000_000_000_000
    assert result["revenue"] == 788_000_000_000
    assert result["net_income_ttm"] == 235_000_000_000
    assert result["shareholder_equity"] == 147.5 * 9_000_000_000
    assert result["debt_to_equity"] == 0.385
    assert result["roe"] == pytest.approx(19.9)
    assert result["financial_statements"]["latest_quarter"]["period_end"] == "2026-06-30"
    assert result["earnings"]["history"][0]["eps_actual"] == 3.2
    assert result["identity"]["verified"] is True
    assert result["source"].endswith("+yfinance_hk")


def test_cn_yfinance_fills_missing_canonical_and_extended_fields(monkeypatch):
    collector = MarketDataCollector.__new__(MarketDataCollector)

    class FakeTicker:
        fast_info = {"shares": 1_250_000_000}
        info = {
            "symbol": "600519.SS",
            "currency": "CNY",
            "currentPrice": 1_520.0,
            "totalRevenue": 180_000_000_000,
            "netIncomeToCommon": 90_000_000_000,
            "bookValue": 180.0,
            "totalDebt": 30_000_000_000,
            "freeCashflow": 70_000_000_000,
            "returnOnEquity": 0.31,
            "revenueGrowth": 0.12,
            "debtToEquity": 10.0,
        }

    monkeypatch.setattr("app.services.market_data_collector.yf.Ticker", lambda _symbol: FakeTicker())
    monkeypatch.setattr(
        collector,
        "_get_financial_statements",
        lambda *_args, **_kwargs: {"latest_quarter": {"period_end": "2026-06-30"}},
    )
    monkeypatch.setattr(collector, "_get_earnings_data", lambda *_args, **_kwargs: {})
    result = {"source": "tencent_quote+akshare_em", "pe_ratio": 20.0, "pb_ratio": 6.0}

    collector._enrich_cn_hk_fundamental_with_yfinance(result, "SH600519", is_hk=False)

    assert result["market_cap"] == 1_900_000_000_000
    assert result["revenue"] == 180_000_000_000
    assert result["net_income_ttm"] == 90_000_000_000
    assert result["shareholder_equity"] == 180.0 * 1_250_000_000
    assert result["roe"] == pytest.approx(31.0)
    assert result["identity"]["requested_symbol"] == "600519.SS"
    assert result["identity"]["verified"] is True
    assert result["source"].endswith("+yfinance_cn")


def test_hk_yfinance_promotes_statement_values_when_info_omits_them(monkeypatch):
    collector = MarketDataCollector.__new__(MarketDataCollector)

    class FakeTicker:
        info = {"symbol": "0005.HK", "currency": "HKD"}

    monkeypatch.setattr("app.services.market_data_collector.yf.Ticker", lambda _symbol: FakeTicker())
    monkeypatch.setattr(
        collector,
        "_get_financial_statements",
        lambda *_args, **_kwargs: {
            "latest_quarter": {
                "period_end": "2026-06-30",
                "income_statement": {"total_revenue": 1000, "net_income": 200},
                "balance_sheet": {"total_equity": 500, "debt": 125},
                "derived": {"revenue_growth": 7.5},
            },
            "ttm": {
                "income_statement": {"net_income": 750},
                "cash_flow": {"free_cash_flow": None},
            },
            "cash_flow": {"free_cash_flow": 80, "period_type": "annual"},
        },
    )
    monkeypatch.setattr(collector, "_get_earnings_data", lambda *_args, **_kwargs: {})
    result = {"source": "tencent_quote"}

    collector._enrich_hk_fundamental_with_yfinance(result, "HK00005")

    assert result["revenue"] == 1000
    assert result["net_income"] == 200
    assert result["net_income_ttm"] == 750
    assert result["shareholder_equity"] == 500
    assert result["total_debt"] == 125
    assert result["free_cash_flow"] == 80
    assert result["revenue_growth"] == 7.5
    assert result["debt_to_equity"] == 0.25


def test_collect_all_honours_caller_core_timeout(monkeypatch):
    from app.services import market_data_collector as module

    collector = MarketDataCollector.__new__(MarketDataCollector)
    collector._get_price = lambda *_args: {"price": 10}
    collector._get_kline = lambda *_args: [{"close": 10}]
    collector._get_fundamental = lambda *_args: {"source": "test"}
    collector._get_company = lambda *_args: {"name": "Test"}
    collector._calculate_indicators = lambda *_args: {"current_price": 10}
    captured = {}
    real_as_completed = module.as_completed

    def recording_as_completed(futures, timeout=None):
        captured["timeout"] = timeout
        return real_as_completed(futures, timeout=timeout)

    monkeypatch.setattr(module, "as_completed", recording_as_completed)

    result = collector.collect_all(
        "USStock", "TEST", include_macro=False, include_news=False, timeout=25
    )

    assert captured["timeout"] == 25.0
    assert result["fundamental"] == {"source": "test"}
    assert result["_meta"]["failed_items"] == []
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z", result["collected_at"])


def test_later_timeframe_backfills_primary_fundamentals_and_repairs_meta():
    primary = {
        "fundamental": {},
        "company": {},
        "_meta": {
            "success_items": ["price", "kline"],
            "failed_items": ["fundamental", "company"],
        },
    }
    candidate = {
        "fundamental": {"source": "yfinance", "revenue": 123},
        "company": {"name": "Test Corp"},
    }

    FastAnalysisService._backfill_primary_enrichment(primary, candidate)

    assert primary["fundamental"]["revenue"] == 123
    assert primary["company"]["name"] == "Test Corp"
    assert set(primary["_meta"]["success_items"]) >= {"fundamental", "company"}
    assert "fundamental" not in primary["_meta"]["failed_items"]
    assert "company" not in primary["_meta"]["failed_items"]
