"""Regression tests for CryptoDataSource timeframe resampling.

Some data providers expose only {1m, 5m, 15m, 30m, 1h, 2h, 6h, 1d}. These tests
cover synthetic higher timeframes without tying the generic resampler to a retired
exchange adapter.

These tests pin the two helpers that make the resample work, without needing a live
exchange or the full data source __init__:
  - `_pick_resample_source` chooses a finer supported granularity + bucket size
  - `_resample_ohlcv` aggregates source candles into target-period candles correctly
"""
from app.data_sources.crypto import CryptoDataSource


# --- _pick_resample_source -------------------------------------------------

LIMITED_INTERVALS = {'1m': 1, '5m': 1, '15m': 1, '30m': 1, '1h': 1, '2h': 1, '6h': 1, '1d': 1}
BINANCE_LIKE = {'1m': 1, '3m': 1, '5m': 1, '15m': 1, '30m': 1, '1h': 1, '2h': 1, '4h': 1, '6h': 1, '12h': 1, '1d': 1, '1w': 1}


def test_pick_source_for_1w_uses_1d_x7():
    assert CryptoDataSource._pick_resample_source('1w', LIMITED_INTERVALS) == ('1d', 7)


def test_pick_source_for_4h_prefers_2h_over_1h():
    assert CryptoDataSource._pick_resample_source('4h', LIMITED_INTERVALS) == ('2h', 2)


def test_pick_source_for_4h_falls_back_to_1h_when_2h_missing():
    only_1h = {k: 1 for k in LIMITED_INTERVALS if k != '2h'}
    assert CryptoDataSource._pick_resample_source('4h', only_1h) == ('1h', 4)


def test_pick_source_for_3m_uses_1m_x3():
    assert CryptoDataSource._pick_resample_source('3m', LIMITED_INTERVALS) == ('1m', 3)


def test_pick_source_returns_none_when_no_supported_finer_granularity():
    # Made-up exchange with only daily resolution can't resample to 1w (well it could,
    # 1d→1w x7 needs 1d), but it can't resample to 4h. Verify the None-on-miss branch.
    only_daily = {'1d': 1}
    assert CryptoDataSource._pick_resample_source('4h', only_daily) is None


def test_pick_source_returns_none_for_unknown_target_timeframe():
    assert CryptoDataSource._pick_resample_source('99x', LIMITED_INTERVALS) is None


# --- _resample_ohlcv -------------------------------------------------------

def _candle(ts_ms, o, h, l, c, v):
    return [ts_ms, o, h, l, c, v]


def test_resample_aggregates_OHLCV_correctly():
    # 7 daily candles → 1 weekly candle
    daily = [
        _candle(1000, 100, 110,  95, 105, 10),
        _candle(2000, 105, 120, 100, 115, 12),
        _candle(3000, 115, 125, 110, 118,  8),
        _candle(4000, 118, 130, 112, 122, 15),
        _candle(5000, 122, 128, 115, 117, 11),
        _candle(6000, 117, 119, 105, 108,  9),
        _candle(7000, 108, 114,  98, 102, 13),
    ]
    out = CryptoDataSource._resample_ohlcv(daily, 7)
    assert len(out) == 1
    [ts, op, hi, lo, cl, vol] = out[0]
    assert ts == 1000          # bucket timestamp = first candle's
    assert op == 100           # bucket open = first candle's open
    assert hi == 130           # max high across the bucket
    assert lo == 95            # min low across the bucket
    assert cl == 102           # close = last candle's close
    assert vol == 10+12+8+15+11+9+13


def test_resample_drops_incomplete_trailing_bucket():
    # 10 daily candles, bucket=7 → 1 full bucket, 3 trailing dropped
    daily = [_candle(1000 * (i + 1), 100, 110, 90, 105, 1) for i in range(10)]
    out = CryptoDataSource._resample_ohlcv(daily, 7)
    assert len(out) == 1
    assert out[0][0] == 1000  # first bucket's start


def test_resample_two_full_buckets():
    daily = [_candle(1000 * (i + 1), 100, 110, 90, 105, 2) for i in range(14)]
    out = CryptoDataSource._resample_ohlcv(daily, 7)
    assert len(out) == 2
    assert out[0][0] == 1000   # first bucket starts at first candle
    assert out[1][0] == 8000   # second bucket starts at 8th candle
    assert out[0][5] == 14     # volume sum = 7 * 2
    assert out[1][5] == 14


def test_resample_bucket_size_one_is_passthrough():
    daily = [_candle(1000, 100, 110, 90, 105, 1)]
    assert CryptoDataSource._resample_ohlcv(daily, 1) == daily


def test_resample_empty_returns_empty():
    assert CryptoDataSource._resample_ohlcv([], 7) == []


# --- _ccxt_to_qd_timeframe -------------------------------------------------

def test_ccxt_to_qd_timeframe_inverts_known_mappings():
    # The TIMEFRAME_MAP maps QD '1D' → ccxt '1d', '1W' → '1w', '1H' → '1h'.
    # The reverse helper must round-trip these for the resample-path bookkeeping.
    assert CryptoDataSource._ccxt_to_qd_timeframe('1d', fallback='1W') == '1D'
    assert CryptoDataSource._ccxt_to_qd_timeframe('1h', fallback='4H') == '1H'
    assert CryptoDataSource._ccxt_to_qd_timeframe('1m', fallback='1m') == '1m'


def test_ccxt_to_qd_timeframe_returns_fallback_for_unknown():
    assert CryptoDataSource._ccxt_to_qd_timeframe('totally-fake', fallback='1W') == '1W'
