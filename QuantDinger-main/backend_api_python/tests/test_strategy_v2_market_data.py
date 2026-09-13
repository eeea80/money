from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import time

import pandas as pd
import pytest

from app.data_sources.errors import (
    MarketDataUnavailableError,
    classify_market_data_failure,
)
from app.services.strategy_v2 import market_data


@pytest.fixture(autouse=True)
def _clear_shared_frame_cache():
    market_data.clear_shared_strategy_frame_cache()
    yield
    market_data.clear_shared_strategy_frame_cache()


def test_market_data_normalizes_numeric_time_series_and_lowercase_timeframe(monkeypatch):
    captured = {}

    def get_kline(**kwargs):
        captured.update(kwargs)
        return [
            {
                "time": 1767225600000,
                "open": 100,
                "high": 102,
                "low": 99,
                "close": 101,
                "volume": 10,
            },
            {
                "time": 1767240000000,
                "open": 101,
                "high": 103,
                "low": 100,
                "close": 102,
                "volume": 11,
            },
        ]

    monkeypatch.setattr(market_data.DataSourceFactory, "get_kline", get_kline)
    monkeypatch.setattr(market_data._cache, "get", lambda _key: None)
    monkeypatch.setattr(market_data._cache, "put", lambda *_args: None)

    frame = market_data.load_strategy_frame(
        "Crypto",
        "BTC/USDT",
        "4h",
        datetime(2026, 1, 1),
        datetime(2026, 1, 1, 4),
        market_type="spot",
    )

    assert len(frame) == 2
    assert frame.index.tz is None
    assert captured["timeframe"] == "4H"
    assert captured["limit"] < 250
    assert captured["after_time"] == int(datetime(2025, 12, 31, 20, tzinfo=timezone.utc).timestamp())
    assert captured["before_time"] == int(datetime(2026, 1, 1, 8, tzinfo=timezone.utc).timestamp())


def test_four_hour_year_requests_enough_bars(monkeypatch):
    captured = {}

    def get_kline(**kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(market_data.DataSourceFactory, "get_kline", get_kline)
    monkeypatch.setattr(market_data._cache, "get", lambda _key: None)

    market_data.load_strategy_frame(
        "Crypto",
        "BTC/USDT",
        "4h",
        datetime(2025, 1, 1),
        datetime(2026, 1, 1),
        market_type="spot",
    )

    assert captured["limit"] > 2400


def test_market_data_normalizes_naive_and_aware_datetimes_to_utc():
    naive = datetime(2026, 7, 19, 4, 14, 13)
    shanghai = timezone(timedelta(hours=8))
    aware = datetime(2026, 7, 19, 12, 14, 13, tzinfo=shanghai)

    normalized_naive = market_data._normalize_utc_datetime(naive)
    normalized_aware = market_data._normalize_utc_datetime(aware)

    assert normalized_naive == datetime(2026, 7, 19, 4, 14, 13, tzinfo=timezone.utc)
    assert normalized_aware == normalized_naive
    assert normalized_naive.timestamp() == normalized_aware.timestamp()


def test_crypto_market_data_rejects_partial_historical_window(monkeypatch):
    monkeypatch.setattr(market_data._cache, "get", lambda _key: None)
    monkeypatch.setattr(market_data._cache, "put", lambda *_args: None)
    monkeypatch.setattr(
        market_data.DataSourceFactory,
        "get_kline",
        lambda **_kwargs: [
            {
                "time": int(datetime(2026, 8, 23, tzinfo=timezone.utc).timestamp()),
                "open": 100,
                "high": 101,
                "low": 99,
                "close": 100,
                "volume": 10,
            },
            {
                "time": int(datetime(2026, 8, 30, tzinfo=timezone.utc).timestamp()),
                "open": 100,
                "high": 101,
                "low": 99,
                "close": 100,
                "volume": 10,
            },
        ],
    )

    with pytest.raises(MarketDataUnavailableError) as raised:
        market_data.load_strategy_frame(
            "Crypto",
            "ETH/USDT",
            "1m",
            datetime(2026, 8, 1),
            datetime(2026, 8, 30),
            market_type="swap",
        )

    assert raised.value.failure.code == "incomplete_market_data"


def test_crypto_market_data_ignores_partial_cached_window(monkeypatch):
    partial = pd.DataFrame(
        {
            "open": [100.0, 101.0],
            "high": [101.0, 102.0],
            "low": [99.0, 100.0],
            "close": [100.0, 101.0],
            "volume": [10.0, 11.0],
        },
        index=pd.DatetimeIndex(["2026-07-23", "2026-07-30"]),
    )
    fresh_rows = [
        {
            "time": int(timestamp.timestamp()),
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100,
            "volume": 10,
        }
        for timestamp in pd.date_range("2026-07-01", "2026-07-30", freq="1D", tz="UTC")
    ]
    calls = []
    monkeypatch.setattr(market_data._cache, "get", lambda _key: partial)
    monkeypatch.setattr(market_data._cache, "put", lambda *_args: None)
    monkeypatch.setattr(
        market_data.DataSourceFactory,
        "get_kline",
        lambda **_kwargs: calls.append(True) or fresh_rows,
    )

    frame = market_data.load_strategy_frame(
        "Crypto",
        "ETH/USDT",
        "1d",
        datetime(2026, 7, 1),
        datetime(2026, 7, 30),
        market_type="swap",
    )

    assert calls == [True]
    assert frame.index.min() == pd.Timestamp("2026-07-01")


def test_shared_market_data_collapses_concurrent_identical_fetches(monkeypatch):
    calls = []

    def load(*_args, **_kwargs):
        calls.append(True)
        time.sleep(0.05)
        index = pd.date_range("2026-08-01 00:00", periods=11, freq="1min")
        return pd.DataFrame({"close": range(len(index))}, index=index)

    monkeypatch.setattr(market_data, "_load_strategy_frame_uncached", load)
    args = (
        "Crypto",
        "BTC/USDT",
        "1m",
        datetime(2026, 8, 1, tzinfo=timezone.utc),
        datetime(2026, 8, 1, 0, 10, tzinfo=timezone.utc),
    )
    with ThreadPoolExecutor(max_workers=4) as pool:
        frames = list(pool.map(lambda _index: market_data.load_strategy_frame(*args), range(4)))

    assert len(calls) == 1
    assert all(len(frame) == 11 for frame in frames)


def test_shared_market_data_extends_only_uncovered_tail(monkeypatch):
    windows = []

    def load(_market, _symbol, _timeframe, start_date, end_date, **_kwargs):
        windows.append((start_date, end_date))
        index = pd.date_range(
            pd.Timestamp(start_date).tz_localize(None),
            pd.Timestamp(end_date).tz_localize(None),
            freq="1min",
        )
        return pd.DataFrame({"close": range(len(index))}, index=index)

    monkeypatch.setattr(market_data, "_load_strategy_frame_uncached", load)
    start = datetime(2026, 8, 1, tzinfo=timezone.utc)
    market_data.load_strategy_frame(
        "Crypto", "ETH/USDT", "1m", start, start + timedelta(minutes=10)
    )
    extended = market_data.load_strategy_frame(
        "Crypto", "ETH/USDT", "1m", start, start + timedelta(minutes=11)
    )

    assert len(windows) == 2
    assert windows[1][0] >= start + timedelta(minutes=8)
    assert windows[1][0] > start
    assert extended.index.is_unique
    assert extended.index.max() == pd.Timestamp("2026-08-01 00:11")


def test_last_completed_bar_cutoff_is_aligned_to_the_previous_minute():
    cutoff = market_data._last_completed_bar_open(
        60,
        now=datetime(2026, 8, 31, 18, 52, 37, tzinfo=timezone.utc),
    )

    assert cutoff == pd.Timestamp("2026-08-31 18:51:00")


def test_live_one_minute_cache_survives_one_missing_bar_and_keeps_refetching(
    monkeypatch,
):
    cutoff = [pd.Timestamp("2026-08-31 18:51:00")]
    calls = []

    def load(_market, _symbol, _timeframe, start_date, end_date, **_kwargs):
        calls.append((start_date, end_date))
        if len(calls) > 1:
            raise MarketDataUnavailableError(
                classify_market_data_failure(
                    "Incomplete K-line coverage",
                    exchange_id="binance",
                    market_type="swap",
                    symbol="BTC/USDT",
                    timeframe="1m",
                )
            )
        index = pd.date_range(
            cutoff[0] - pd.Timedelta(minutes=99),
            cutoff[0],
            freq="1min",
        )
        return pd.DataFrame({"close": range(len(index))}, index=index)

    monkeypatch.setattr(market_data, "_load_strategy_frame_uncached", load)
    monkeypatch.setattr(
        market_data,
        "_last_completed_bar_open",
        lambda _seconds: cutoff[0],
    )
    start = cutoff[0].to_pydatetime().replace(tzinfo=timezone.utc) - timedelta(minutes=99)
    first_end = cutoff[0].to_pydatetime().replace(tzinfo=timezone.utc)

    first = market_data.load_strategy_frame(
        "Crypto",
        "BTC/USDT",
        "1m",
        start,
        first_end,
        market_type="swap",
        exchange_id="binance",
    )
    cutoff[0] += pd.Timedelta(minutes=1)
    next_end = cutoff[0].to_pydatetime().replace(tzinfo=timezone.utc)
    second = market_data.load_strategy_frame(
        "Crypto",
        "BTC/USDT",
        "1m",
        start,
        next_end,
        market_type="swap",
        exchange_id="binance",
    )
    third = market_data.load_strategy_frame(
        "Crypto",
        "BTC/USDT",
        "1m",
        start,
        next_end,
        market_type="swap",
        exchange_id="binance",
    )

    assert len(first) == 100
    assert second.index.max() == pd.Timestamp("2026-08-31 18:51:00")
    assert third.index.max() == second.index.max()
    assert len(calls) == 3


def test_live_one_minute_cache_rejects_data_older_than_grace_window(monkeypatch):
    cutoff = [pd.Timestamp("2026-08-31 18:51:00")]
    calls = []

    def load(_market, _symbol, _timeframe, _start_date, _end_date, **_kwargs):
        calls.append(True)
        if len(calls) > 1:
            return pd.DataFrame()
        index = pd.date_range(
            cutoff[0] - pd.Timedelta(minutes=199),
            cutoff[0],
            freq="1min",
        )
        return pd.DataFrame({"close": range(len(index))}, index=index)

    monkeypatch.setattr(market_data, "_load_strategy_frame_uncached", load)
    monkeypatch.setattr(
        market_data,
        "_last_completed_bar_open",
        lambda _seconds: cutoff[0],
    )
    start = cutoff[0].to_pydatetime().replace(tzinfo=timezone.utc) - timedelta(minutes=199)
    first_end = cutoff[0].to_pydatetime().replace(tzinfo=timezone.utc)
    market_data.load_strategy_frame(
        "Crypto",
        "ETH/USDT",
        "1m",
        start,
        first_end,
        market_type="swap",
        exchange_id="binance",
    )
    cutoff[0] += pd.Timedelta(minutes=3)

    stale = market_data.load_strategy_frame(
        "Crypto",
        "ETH/USDT",
        "1m",
        start,
        cutoff[0].to_pydatetime().replace(tzinfo=timezone.utc),
        market_type="swap",
        exchange_id="binance",
    )

    assert stale.empty
    assert len(calls) == 2


def test_initial_incomplete_one_minute_warmup_retries_once(monkeypatch):
    calls = []
    start = datetime(2026, 8, 1, tzinfo=timezone.utc)
    end = start + timedelta(minutes=10)

    def load(*_args, **_kwargs):
        calls.append(True)
        if len(calls) == 1:
            raise MarketDataUnavailableError(
                classify_market_data_failure(
                    "Incomplete K-line coverage",
                    exchange_id="binance",
                    market_type="swap",
                    symbol="BTC/USDT",
                    timeframe="1m",
                )
            )
        index = pd.date_range(start.replace(tzinfo=None), periods=11, freq="1min")
        return pd.DataFrame({"close": range(len(index))}, index=index)

    monkeypatch.setattr(market_data, "_load_strategy_frame_uncached", load)

    frame = market_data.load_strategy_frame(
        "Crypto",
        "BTC/USDT",
        "1m",
        start,
        end,
        market_type="swap",
        exchange_id="binance",
    )

    assert len(calls) == 2
    assert len(frame) == 11
