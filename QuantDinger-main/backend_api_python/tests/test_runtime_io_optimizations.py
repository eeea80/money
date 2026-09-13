from datetime import datetime, timezone
import json

from app.data_sources.us_stock import USStockDataSource
from app.services.strategy_runtime import state
from app.services.strategy_runtime.timeframes import completed_bar_token
from app.services.trading_executor import TradingExecutor
from app.services.trading_executor import _latest_frame_timestamp


def test_completed_bar_token_changes_only_after_next_bar_boundary():
    first = completed_bar_token(
        "1m", datetime(2026, 8, 31, 12, 0, 5, tzinfo=timezone.utc)
    )
    same = completed_bar_token(
        "1m", datetime(2026, 8, 31, 12, 0, 59, tzinfo=timezone.utc)
    )
    following = completed_bar_token(
        "1m", datetime(2026, 8, 31, 12, 1, 0, tzinfo=timezone.utc)
    )

    assert first == same
    assert following == first + 1


def test_runtime_state_coalesces_snapshots_and_flushes_latest(monkeypatch):
    executions = []

    class Cursor:
        def execute(self, _sql, params):
            executions.append(params)

        def close(self):
            pass

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def cursor(self):
            return Cursor()

        def commit(self):
            pass

    clock = iter([100.0, 101.0, 102.0])
    monkeypatch.setattr(state, "get_db_connection", Connection)
    monkeypatch.setattr(state.time, "monotonic", lambda: next(clock))
    store = state.RuntimeStateStore(strategy_id=9, strategy_run_id=2)

    assert store.save({"step": 1}, min_interval_seconds=5) is True
    assert store.save({"step": 2}, min_interval_seconds=5) is False
    assert store.flush() is True

    assert len(executions) == 2
    assert json.loads(executions[-1][-1]) == {"step": 2}


def test_us_stock_quote_batch_deduplicates_and_caches(monkeypatch):
    source = USStockDataSource.__new__(USStockDataSource)
    source.finnhub_client = None
    source.clear_quote_cache()
    calls = []

    def fetch(symbol):
        calls.append(symbol)
        return {"symbol": symbol, "last": 100.0}

    monkeypatch.setattr(source, "_fetch_ticker", fetch)
    monkeypatch.setattr(source, "_fetch_yfinance_batch_quotes", lambda _symbols: {})
    monkeypatch.setenv("US_STOCK_QUOTE_BATCH_WINDOW_MS", "0")
    first = source.get_tickers(["msft", "AAPL", "MSFT"])
    second = source.get_tickers(["AAPL", "MSFT"])

    assert set(first) == {"AAPL", "MSFT"}
    assert set(second) == {"AAPL", "MSFT"}
    assert calls == ["AAPL", "MSFT"]


def test_us_stock_quote_batch_prefers_one_bulk_request(monkeypatch):
    source = USStockDataSource.__new__(USStockDataSource)
    source.finnhub_client = None
    source.clear_quote_cache()
    batches = []

    def fetch_batch(symbols):
        batches.append(symbols)
        return {symbol: {"last": 100.0} for symbol in symbols}

    monkeypatch.setattr(source, "_fetch_yfinance_batch_quotes", fetch_batch)
    monkeypatch.setenv("US_STOCK_QUOTE_BATCH_WINDOW_MS", "0")
    monkeypatch.setattr(
        source,
        "_fetch_ticker",
        lambda _symbol: (_ for _ in ()).throw(AssertionError("fallback not expected")),
    )

    quotes = source.get_tickers(["MSFT", "AAPL", "NVDA"])

    assert batches == [["AAPL", "MSFT", "NVDA"]]
    assert set(quotes) == {"MSFT", "AAPL", "NVDA"}


def test_concurrent_us_stock_quotes_join_one_batch(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    source = USStockDataSource.__new__(USStockDataSource)
    source.finnhub_client = None
    source.clear_quote_cache()
    batches = []

    def fetch_batch(symbols):
        batches.append(symbols)
        return {symbol: {"last": 100.0} for symbol in symbols}

    monkeypatch.setattr(source, "_fetch_yfinance_batch_quotes", fetch_batch)
    monkeypatch.setenv("US_STOCK_QUOTE_BATCH_WINDOW_MS", "50")
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(source.get_ticker, ["MSFT", "AAPL", "NVDA"]))

    assert batches == [["AAPL", "MSFT", "NVDA"]]
    assert all(result["last"] == 100.0 for result in results)


def test_latest_frame_timestamp_detects_candle_advancement():
    import pandas as pd

    first = pd.DataFrame(
        {"close": [1.0]},
        index=pd.DatetimeIndex(["2026-08-31T12:00:00Z"]),
    )
    second = pd.DataFrame(
        {"close": [1.0, 2.0]},
        index=pd.DatetimeIndex([
            "2026-08-31T12:00:00Z",
            "2026-08-31T12:01:00Z",
        ]),
    )

    assert _latest_frame_timestamp(second) > _latest_frame_timestamp(first)


def test_latest_frame_timestamp_reads_strategy_instrument_panel():
    import pandas as pd

    panel = {
        "Crypto:BTC/USDT@swap": pd.DataFrame(
            {"close": [1.0, 2.0]},
            index=pd.DatetimeIndex([
                "2026-08-31T12:00:00Z",
                "2026-08-31T12:01:00Z",
            ]),
        ),
        "Crypto:ETH/USDT@swap": pd.DataFrame(
            {"close": [3.0]},
            index=pd.DatetimeIndex(["2026-08-31T12:02:00Z"]),
        ),
    }

    assert _latest_frame_timestamp(panel) == pd.Timestamp("2026-08-31T12:02:00Z")
    assert _latest_frame_timestamp({}) is None


def test_finnhub_429_blocks_followup_requests_across_symbols(monkeypatch):
    class Client:
        def __init__(self):
            self.calls = []

        def quote(self, symbol):
            self.calls.append(symbol)
            raise RuntimeError("429 rate limit")

    source = USStockDataSource.__new__(USStockDataSource)
    source.finnhub_client = Client()
    source.clear_quote_cache()
    monkeypatch.setenv("FINNHUB_QUOTE_MIN_INTERVAL_SEC", "0")

    assert source._fetch_finnhub_quote("MSFT") == {}
    assert source._fetch_finnhub_quote("AAPL") == {}
    assert source.finnhub_client.calls == ["MSFT"]


def test_live_prices_fetches_each_market_group_as_one_batch(monkeypatch):
    batches = []

    def get_tickers(market, symbols, exchange_id=None, market_type=None):
        batches.append((market, symbols, exchange_id, market_type))
        return {symbol: {"last": index + 100.0} for index, symbol in enumerate(symbols)}

    from app.services import trading_executor

    monkeypatch.setattr(trading_executor.DataSourceFactory, "get_tickers", get_tickers)
    prices = TradingExecutor._live_prices([
        {"key": "USStock:MSFT", "market": "USStock", "symbol": "MSFT"},
        {"key": "USStock:AAPL", "market": "USStock", "symbol": "AAPL"},
    ])

    assert len(batches) == 1
    assert batches[0][1] == ["MSFT", "AAPL"]
    assert prices == {"USStock:MSFT": 100.0, "USStock:AAPL": 101.0}
