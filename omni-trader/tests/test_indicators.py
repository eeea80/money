"""Unit tests for indicators — including flat series and division-by-zero guards."""

import numpy as np
import pandas as pd
import pytest

from omni_trader import indicators as ind


def make_df(n=100, seed=7, base=100.0):
    rng = np.random.default_rng(seed)
    close = pd.Series(base * np.exp(np.cumsum(rng.normal(0, 0.01, n))))
    open_ = close.shift(1).fillna(base)
    spread = (np.abs(rng.normal(0, 0.005, n)) * close)
    return pd.DataFrame({
        "open": open_,
        "high": np.maximum(open_, close) + spread,
        "low": np.minimum(open_, close) - spread,
        "close": close,
    })


# ---------------------------------------------------------------- EMA
def test_ema_basic():
    s = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0])
    out = ind.ema(s, 3)
    assert len(out) == len(s)
    assert out.iloc[-1] == pytest.approx(s.iloc[-1], rel=1e-9) or out.iloc[-1] < 5
    assert not out.isna().any()


def test_ema_flat_series():
    s = pd.Series([5.0] * 50)
    out = ind.ema(s, 12)
    assert (out == 5.0).all()


def test_ema_invalid_period():
    with pytest.raises(ValueError):
        ind.ema(pd.Series([1.0, 2.0]), 0)


# ---------------------------------------------------------------- RSI
def test_rsi_flat_series_is_neutral_not_nan():
    s = pd.Series([50.0] * 60)
    out = ind.rsi(s, 14)
    assert len(out) == 60
    # warm-up region NaN, afterwards exactly 50 (no div-by-zero, no 0/100)
    assert out.iloc[14:].eq(50.0).all()


def test_rsi_all_gains_is_100():
    s = pd.Series(np.arange(1.0, 61.0))
    out = ind.rsi(s, 14)
    assert out.iloc[-1] == pytest.approx(100.0)


def test_rsi_all_losses_is_0():
    s = pd.Series(np.arange(60.0, 0.0, -1.0))
    out = ind.rsi(s, 14)
    assert out.iloc[-1] == pytest.approx(0.0)


def test_rsi_range():
    df = make_df()
    out = ind.rsi(df["close"], 14)
    valid = out.dropna()
    assert ((valid >= 0) & (valid <= 100)).all()


# ---------------------------------------------------------------- MACD
def test_macd_shapes_and_flat():
    s = pd.Series([10.0] * 60)
    line, sig, hist = ind.macd(s)
    assert len(line) == len(sig) == len(hist) == 60
    assert line.abs().sum() == pytest.approx(0.0)
    assert hist.abs().sum() == pytest.approx(0.0)

    df = make_df()
    line, sig, hist = ind.macd(df["close"])
    assert (hist == line - sig).all()


def test_macd_param_guard():
    with pytest.raises(ValueError):
        ind.macd(pd.Series([1.0, 2.0, 3.0]), fast=26, slow=12)


# ---------------------------------------------------------------- ATR
def test_atr_flat_and_positive():
    flat = pd.DataFrame({
        "open": [10.0] * 30, "high": [10.0] * 30,
        "low": [10.0] * 30, "close": [10.0] * 30,
    })
    out = ind.atr(flat, 14)
    assert out.dropna().eq(0.0).all()  # zero range, not NaN/inf

    df = make_df()
    out = ind.atr(df, 14)
    assert (out.dropna() > 0).all()


# ---------------------------------------------------------------- Bollinger
def test_bollinger_flat_series_bands_collapse():
    s = pd.Series([100.0] * 40)
    upper, mid, lower = ind.bollinger(s, 20, 2.0)
    assert mid.dropna().eq(100.0).all()
    assert upper.dropna().eq(100.0).all()
    assert lower.dropna().eq(100.0).all()
    # no NaN/inf anywhere after warmup
    assert not np.isinf(upper.dropna()).any()


def test_bollinger_bounds_on_random():
    df = make_df(200)
    upper, mid, lower = ind.bollinger(df["close"], 20, 2.0)
    valid = mid.dropna().index
    assert (upper[valid] >= lower[valid]).all()
    assert (upper[valid] >= mid[valid]).all()
    assert (mid[valid] >= lower[valid]).all()


# ---------------------------------------------------------------- Patterns
def _ohlc(rows):
    return pd.DataFrame(rows, columns=["open", "high", "low", "close"])


def test_bullish_engulfing_detects():
    df = _ohlc([
        [10.0, 10.5, 9.5, 9.6],    # prev bearish body 9.6->10.0
        [9.4, 10.8, 9.2, 10.6],    # current bullish engulfs
        [10.0, 11.0, 10.0, 10.9],
    ])
    out = ind.is_bullish_engulfing(df)
    assert bool(out.iloc[1]) is True
    assert bool(out.iloc[0]) is False


def test_bearish_engulfing_detects():
    df = _ohlc([
        [10.0, 10.8, 9.9, 10.6],   # prev bullish
        [10.9, 11.0, 9.3, 9.5],    # current bearish engulfs
        [9.5, 10.0, 9.0, 9.9],
    ])
    out = ind.is_bearish_engulfing(df)
    assert bool(out.iloc[1]) is True


def test_hammer_and_shooting_star_geometry():
    hammer = _ohlc([
        [10.0, 10.4, 9.9, 10.1],
        [10.1, 10.3, 9.0, 10.25],  # long lower wick: low 9.0, body ~10.1-10.25
        [10.2, 10.5, 10.1, 10.4],
    ])
    assert bool(ind.is_hammer(hammer).iloc[1]) is True

    star = _ohlc([
        [10.0, 10.4, 9.9, 10.1],
        [10.25, 11.5, 10.1, 10.4],  # long upper wick
        [10.4, 10.6, 10.2, 10.5],
    ])
    assert bool(ind.is_shooting_star(star).iloc[1]) is True


def test_doji_and_zero_range_guard():
    flat = _ohlc([
        [10.0, 10.0, 10.0, 10.0],  # zero range -> doji (flat), no div-by-zero
        [10.0, 10.0, 10.0, 10.0],
    ])
    assert bool(ind.is_doji(flat).iloc[0]) is True
    # hammer/shooting star must be False (not crash) on zero-range
    assert bool(ind.is_hammer(flat).iloc[0]) is False
    assert bool(ind.is_shooting_star(flat).iloc[0]) is False

    doji = _ohlc([
        [10.0, 10.6, 9.4, 10.01],  # body 0.01 of range 1.2
        [10.0, 10.5, 9.5, 10.3],
    ])
    assert bool(ind.is_doji(doji).iloc[0]) is True


def test_patterns_frame_shape():
    df = make_df(60)
    out = ind.detect_patterns(df)
    assert list(out.columns) == [
        "bullish_engulfing", "bearish_engulfing", "hammer",
        "shooting_star", "doji",
    ]
    assert out.dtypes.eq(bool).all()
