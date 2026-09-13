from types import SimpleNamespace
from datetime import datetime, timezone

import pytest

from app.data_sources.crypto import (
    PUBLIC_KLINE_EXCHANGE_IDS,
    CryptoDataSource,
    resolve_ccxt_for_live_trading,
)
from app.data_sources.factory import DataSourceFactory


@pytest.mark.parametrize(
    ("exchange_id", "market_type", "expected_ccxt_id", "expected_default_type"),
    [
        ("binance", "spot", "binance", None),
        ("binance", "swap", "binanceusdm", None),
        ("bitget", "spot", "bitget", "spot"),
        ("bitget", "swap", "bitget", "swap"),
        ("bybit", "spot", "bybit", "spot"),
        ("bybit", "swap", "bybit", "linear"),
        ("okx", "spot", "okx", "spot"),
        ("okx", "swap", "okx", "swap"),
        ("gate", "spot", "gate", "spot"),
        ("gate", "swap", "gate", "swap"),
        ("htx", "spot", "htx", "spot"),
        ("htx", "swap", "htx", "swap"),
    ],
)
def test_public_kline_exchange_mapping(
    exchange_id,
    market_type,
    expected_ccxt_id,
    expected_default_type,
):
    ccxt_id, options = resolve_ccxt_for_live_trading(exchange_id, market_type)

    assert ccxt_id == expected_ccxt_id
    assert options.get("defaultType") == expected_default_type


def test_public_kline_exchange_list_is_stable():
    assert PUBLIC_KLINE_EXCHANGE_IDS == (
        "binance",
        "bitget",
        "bybit",
        "okx",
        "gate",
        "htx",
    )


def test_unscoped_public_kline_defaults_to_okx(monkeypatch):
    captured = {}
    monkeypatch.delenv("CRYPTO_PUBLIC_KLINE_PRIMARY", raising=False)
    monkeypatch.setattr(
        CryptoDataSource,
        "_init_ccxt_exchange",
        lambda self, exchange_id, options: captured.update(exchange_id=exchange_id, options=options),
    )

    CryptoDataSource()

    assert captured["exchange_id"] == "okx"


def test_swap_symbol_uses_settlement_suffix():
    source = object.__new__(CryptoDataSource)
    source._scoped_market_type = "swap"
    source.exchange = SimpleNamespace(id="okx")
    source._markets_loaded = True
    source._markets_cache = {"BTC/USDT": {"active": True}}

    assert source._symbol_for_scoped_market("BTC/USDT") == "BTC/USDT:USDT"


def test_crypto_kline_is_pure_ohlcv_and_preserves_price_precision():
    now_s = int(datetime.now(timezone.utc).timestamp())
    source = object.__new__(CryptoDataSource)
    source._allow_public_fallback = False
    source._preferred_public_exchange_id = ""
    source._scoped_market_type = "swap"
    source.exchange = SimpleNamespace(id="binanceusdm", timeframes={"1m": "1m"})
    source._markets_loaded = False
    source._markets_cache = None
    source._fetch_ohlcv = lambda *_args, **_kwargs: [
        [now_s * 1000, "0.01038", "0.010381", "0.010379", "0.01038", "12.3456"],
    ]
    source.log_result = lambda *_args, **_kwargs: None

    rows = source.get_kline("TUT/USDT", "1m", 1)

    assert rows == [{
        "time": now_s,
        "open": 0.01038,
        "high": 0.010381,
        "low": 0.010379,
        "close": 0.01038,
        "volume": 12.35,
    }]


def test_gate_long_range_fetch_refuses_partial_recent_candle_window():
    now_s = int(datetime.now(timezone.utc).timestamp())
    requested_since_s = now_s - 30 * 24 * 60 * 60
    calls = []

    def fetch_ohlcv(symbol, timeframe, since, limit):
        calls.append({"symbol": symbol, "timeframe": timeframe, "since": since, "limit": limit})
        return [[now_s * 1000, 100.0, 101.0, 99.0, 100.5, 10.0]]

    source = object.__new__(CryptoDataSource)
    source.exchange = SimpleNamespace(id="gate", enableRateLimit=True, fetch_ohlcv=fetch_ohlcv)

    rows = source._fetch_ohlcv(
        "BTC/USDT:USDT",
        "1m",
        50000,
        now_s,
        "1m",
        requested_since_s,
    )

    assert rows == []
    assert calls == []


def test_historical_window_is_not_replaced_with_recent_candles():
    now_s = int(datetime.now(timezone.utc).timestamp())
    calls = []

    def fetch_ohlcv(symbol, timeframe, since=None, limit=None):
        calls.append(since)
        if since is not None:
            raise RuntimeError("requested history window is unavailable")
        return [[now_s * 1000, 100.0, 101.0, 99.0, 100.5, 10.0]]

    source = object.__new__(CryptoDataSource)
    source.exchange = SimpleNamespace(id="bitget", enableRateLimit=True, fetch_ohlcv=fetch_ohlcv)

    rows = source._fetch_ohlcv(
        "BTC/USDT:USDT",
        "1m",
        50000,
        now_s,
        "1m",
        now_s - 30 * 24 * 60 * 60,
    )

    assert rows == []
    assert calls
    assert None not in calls


def test_unscoped_crypto_kline_falls_back_to_another_public_exchange(monkeypatch):
    source = object.__new__(CryptoDataSource)
    source._allow_public_fallback = True
    source.exchange = SimpleNamespace(id="binance", timeframes={})
    source._symbol_for_scoped_market = lambda _symbol: "BTC/USDT"
    source._is_invalid_symbol_cached = lambda _symbol: False
    source._fetch_ohlcv = lambda *_args, **_kwargs: []

    expected = [{
        "time": 1,
        "open": 2.0,
        "high": 3.0,
        "low": 1.0,
        "close": 2.5,
        "volume": 4.0,
    }]
    attempts = []

    class FallbackSource:
        def get_kline(self, *_args, **_kwargs):
            return expected

    monkeypatch.setattr(
        CryptoDataSource,
        "for_exchange",
        classmethod(
            lambda _cls, exchange_id, market_type: (
                attempts.append((exchange_id, market_type)) or FallbackSource()
            )
        ),
    )

    rows = source.get_kline("BTC/USDT", "1H", 10)

    assert rows == expected
    assert attempts == [("okx", "spot")]


def test_unscoped_swap_kline_fallback_preserves_market_type(monkeypatch):
    source = object.__new__(CryptoDataSource)
    source._allow_public_fallback = True
    source._scoped_market_type = "swap"
    source.exchange = SimpleNamespace(id="binanceusdm", timeframes={})
    source._symbol_for_scoped_market = lambda _symbol: "BTC/USDT:USDT"
    source._is_invalid_symbol_cached = lambda _symbol: False
    source._fetch_ohlcv = lambda *_args, **_kwargs: []

    expected = [{
        "time": 1,
        "open": 2.0,
        "high": 3.0,
        "low": 1.0,
        "close": 2.5,
        "volume": 4.0,
    }]
    attempts = []

    class FallbackSource:
        def get_kline(self, *_args, **_kwargs):
            return expected

    monkeypatch.setattr(
        CryptoDataSource,
        "for_exchange",
        classmethod(
            lambda _cls, exchange_id, market_type: (
                attempts.append((exchange_id, market_type)) or FallbackSource()
            )
        ),
    )

    rows = source.get_kline("BTC/USDT", "1m", 10)

    assert rows == expected
    assert attempts == [("okx", "swap")]


def test_public_kline_reuses_successful_fallback_without_retrying_failed_primary(monkeypatch):
    source = object.__new__(CryptoDataSource)
    source._allow_public_fallback = True
    source._scoped_market_type = "swap"
    source._preferred_public_exchange_id = ""
    source.exchange = SimpleNamespace(id="binanceusdm", timeframes={})
    source._symbol_for_scoped_market = lambda _symbol: "BTC/USDT:USDT"
    source._is_invalid_symbol_cached = lambda _symbol: False
    primary_attempts = []
    source._fetch_ohlcv = lambda *_args, **_kwargs: primary_attempts.append(True) or []

    expected = [{
        "time": 1,
        "open": 2.0,
        "high": 3.0,
        "low": 1.0,
        "close": 2.5,
        "volume": 4.0,
    }]
    fallback_attempts = []

    class FallbackSource:
        def get_kline(self, *_args, **_kwargs):
            return expected

    monkeypatch.setattr(
        CryptoDataSource,
        "for_exchange",
        classmethod(
            lambda _cls, exchange_id, market_type: (
                fallback_attempts.append((exchange_id, market_type)) or FallbackSource()
            )
        ),
    )

    assert source.get_kline("BTC/USDT", "4H", 10) == expected
    assert source.get_kline("BTC/USDT", "4H", 10) == expected
    assert primary_attempts == [True]
    assert fallback_attempts == [("okx", "swap"), ("okx", "swap")]


def test_public_ticker_reuses_kline_promoted_provider(monkeypatch):
    source = object.__new__(CryptoDataSource)
    source._allow_public_fallback = True
    source._scoped_market_type = "swap"
    source._preferred_public_exchange_id = "bitget"
    primary_calls = []
    source.exchange = SimpleNamespace(
        id="binanceusdm",
        fetch_ticker=lambda _symbol: primary_calls.append(True) or {"last": 0},
    )
    source._symbol_for_scoped_market = lambda _symbol: "BTC/USDT:USDT"
    source._is_invalid_symbol_cached = lambda _symbol: False

    fallback_calls = []

    class FallbackSource:
        def get_ticker(self, symbol):
            fallback_calls.append(symbol)
            return {"last": 123.45, "symbol": symbol}

    monkeypatch.setattr(
        CryptoDataSource,
        "for_exchange",
        classmethod(lambda _cls, exchange_id, market_type: FallbackSource()),
    )

    ticker = source.get_ticker("BTC/USDT")

    assert ticker["last"] == pytest.approx(123.45)
    assert fallback_calls == ["BTC/USDT"]
    assert primary_calls == []


def test_backtest_swap_source_allows_public_failover_but_live_source_stays_scoped(monkeypatch):
    public_source = object()
    live_source = object()
    monkeypatch.setattr(
        CryptoDataSource,
        "for_public_market",
        classmethod(lambda _cls, market_type: public_source),
    )
    monkeypatch.setattr(
        CryptoDataSource,
        "for_exchange",
        classmethod(lambda _cls, exchange_id, market_type: live_source),
    )

    assert DataSourceFactory._resolve_source("Crypto", market_type="swap") is public_source
    assert DataSourceFactory._resolve_source(
        "Crypto",
        exchange_id="gate",
        market_type="swap",
    ) is live_source


def test_scoped_crypto_kline_does_not_cross_exchange(monkeypatch):
    source = object.__new__(CryptoDataSource)
    source._allow_public_fallback = False
    source.exchange = SimpleNamespace(id="binance", timeframes={})
    source._symbol_for_scoped_market = lambda _symbol: "BTC/USDT"
    source._is_invalid_symbol_cached = lambda _symbol: False
    source._fetch_ohlcv = lambda *_args, **_kwargs: []

    attempts = []
    monkeypatch.setattr(
        CryptoDataSource,
        "for_exchange",
        classmethod(
            lambda _cls, exchange_id, market_type: attempts.append((exchange_id, market_type))
        ),
    )

    rows = source.get_kline("BTC/USDT", "1H", 10)

    assert rows == []
    assert attempts == []
