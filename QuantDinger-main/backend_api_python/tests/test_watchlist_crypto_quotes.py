import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from app.data_sources.crypto import CryptoDataSource
from app.services.market import quotes
from app.utils.request_guard import guarded_cached


def _unique_symbol() -> str:
    return f"TEST{uuid.uuid4().hex[:10].upper()}/USDT"


def test_crypto_watchlist_quote_uses_current_default_exchange(monkeypatch):
    calls = []

    def fake_realtime_price(market, symbol, **kwargs):
        calls.append((market, symbol, kwargs))
        return {"price": 100.0, "change": 1.0, "changePercent": 1.0, "source": "ticker"}

    monkeypatch.setattr(quotes, "default_crypto_exchange_id", lambda: "okx")
    monkeypatch.setattr(quotes.kline_service, "get_realtime_price", fake_realtime_price)

    result = quotes.get_single_price("Crypto", _unique_symbol())

    assert result["price"] == 100.0
    assert result["exchange_id"] == ""
    assert result["source_exchange_id"] == "okx"
    assert result["source_market_type"] == "spot"
    assert calls[0][2]["exchange_id"] == "okx"
    assert calls[0][2]["market_type"] == "spot"


def test_zero_quote_is_not_cached(monkeypatch):
    responses = [
        {"price": 0, "source": "unknown"},
        {"price": 123.45, "change": 0, "changePercent": 0, "source": "ticker"},
    ]

    monkeypatch.setattr(
        quotes.kline_service,
        "get_realtime_price",
        lambda *args, **kwargs: responses.pop(0),
    )
    symbol = _unique_symbol()

    first = quotes.get_single_price("USStock", symbol)
    second = quotes.get_single_price("USStock", symbol)

    assert first["price"] == 0
    assert second["price"] == 123.45
    assert responses == []


def test_crypto_catalog_skips_missing_spot_and_uses_same_exchange_swap(monkeypatch):
    calls = []

    def fake_realtime_price(market, symbol, **kwargs):
        calls.append((market, symbol, kwargs))
        return {
            "price": 3456.78,
            "change": 12.3,
            "changePercent": 0.36,
            "source": "ticker",
        }

    def fake_find_market_symbol(market, symbol, **kwargs):
        if kwargs["market_type"] == "swap":
            return {"market": market, "symbol": symbol, **kwargs}
        return None

    monkeypatch.setattr(quotes, "default_crypto_exchange_id", lambda: "okx")
    monkeypatch.setattr(quotes, "find_market_symbol", fake_find_market_symbol)
    monkeypatch.setattr(quotes.kline_service, "get_realtime_price", fake_realtime_price)

    result = quotes.get_single_price("Crypto", "XAU/USDT")

    assert result["price"] == 3456.78
    assert result["exchange_id"] == ""
    assert result["market_type"] == ""
    assert result["source_exchange_id"] == "okx"
    assert result["source_market_type"] == "swap"
    assert [call[2]["market_type"] for call in calls] == ["swap"]
    assert all(call[2]["exchange_id"] == "okx" for call in calls)


def test_crypto_spot_runtime_miss_falls_back_to_swap(monkeypatch):
    calls = []

    def fake_realtime_price(market, symbol, **kwargs):
        calls.append((market, symbol, kwargs))
        if kwargs["market_type"] == "swap":
            return {"price": 39.21, "source": "ticker"}
        return {"price": 0, "source": "unknown"}

    monkeypatch.setattr(quotes, "default_crypto_exchange_id", lambda: "okx")
    monkeypatch.setattr(quotes, "find_market_symbol", lambda *args, **kwargs: None)
    monkeypatch.setattr(quotes.kline_service, "get_realtime_price", fake_realtime_price)

    result = quotes.get_single_price("Crypto", _unique_symbol())

    assert result["price"] == 39.21
    assert result["source_exchange_id"] == "okx"
    assert result["source_market_type"] == "swap"
    assert [call[2]["market_type"] for call in calls] == ["spot", "swap"]


def test_regular_crypto_stays_spot_first_when_only_swap_is_cataloged(monkeypatch):
    calls = []

    def fake_realtime_price(market, symbol, **kwargs):
        calls.append((market, symbol, kwargs))
        return {"price": 64190.2, "source": "ticker"}

    monkeypatch.setattr(quotes, "default_crypto_exchange_id", lambda: "okx")
    monkeypatch.setattr(
        quotes,
        "find_market_symbol",
        lambda market, symbol, **kwargs: {"market": market, "symbol": symbol, **kwargs},
    )
    monkeypatch.setattr(quotes.kline_service, "get_realtime_price", fake_realtime_price)

    result = quotes.get_single_price("Crypto", "BTC/USDT")

    assert result["price"] == 64190.2
    assert result["source_market_type"] == "spot"
    assert [call[2]["market_type"] for call in calls] == ["spot"]


def test_non_crypto_zero_quote_does_not_try_swap(monkeypatch):
    calls = []

    def fake_realtime_price(market, symbol, **kwargs):
        calls.append((market, symbol, kwargs))
        return {"price": 0, "source": "unknown"}

    monkeypatch.setattr(quotes.kline_service, "get_realtime_price", fake_realtime_price)

    result = quotes.get_single_price("USStock", f"MSFT{uuid.uuid4().hex[:8]}")

    assert result["price"] == 0
    assert len(calls) == 1
    assert calls[0][2]["exchange_id"] is None
    assert calls[0][2]["market_type"] is None


def test_crypto_price_map_resolves_default_exchange_before_workers(monkeypatch):
    exchange_calls = []
    quote_calls = []

    def fake_default_exchange():
        exchange_calls.append(True)
        return "okx" if len(exchange_calls) == 1 else "binance"

    def fake_realtime_price(market, symbol, **kwargs):
        quote_calls.append((market, symbol, kwargs))
        return {"price": 100.0, "source": "ticker"}

    monkeypatch.setattr(quotes, "default_crypto_exchange_id", fake_default_exchange)
    monkeypatch.setattr(quotes.kline_service, "get_realtime_price", fake_realtime_price)

    results = quotes.get_price_map([
        {"market": "Crypto", "symbol": _unique_symbol()},
        {"market": "Crypto", "symbol": _unique_symbol()},
    ])

    assert len(results) == 2
    assert len(exchange_calls) == 1
    assert all(call[2]["exchange_id"] == "okx" for call in quote_calls)
    assert all(result["exchange_id"] == "" for result in results)


def test_request_guard_cache_predicate_skips_rejected_values():
    values = [0, 1]
    key = f"cache-predicate-{uuid.uuid4().hex}"

    first = guarded_cached(
        key,
        lambda: values.pop(0),
        ttl_sec=60,
        cache_if=lambda value: value > 0,
    )
    second = guarded_cached(
        key,
        lambda: values.pop(0),
        ttl_sec=60,
        cache_if=lambda value: value > 0,
    )

    assert first == 0
    assert second == 1
    assert values == []


def test_crypto_market_loading_is_singleflight():
    class FakeExchange:
        id = "okx"

        def __init__(self):
            self.calls = 0
            self.markets = {}
            self.lock = threading.Lock()

        def load_markets(self, reload=False):
            with self.lock:
                self.calls += 1
            time.sleep(0.05)
            self.markets = {"BTC/USDT": {"symbol": "BTC/USDT"}}

    source = object.__new__(CryptoDataSource)
    source.exchange = FakeExchange()
    source._markets_loaded = False
    source._markets_cache = None
    source._markets_load_lock = threading.Lock()

    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(lambda _: source._ensure_markets_loaded(), range(3)))

    assert results == [True, True, True]
    assert source.exchange.calls == 1
