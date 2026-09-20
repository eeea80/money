"""Technical indicators — pure functions on pandas Series/DataFrame.

Formulas follow standard definitions (Wilder smoothing for RSI/ATR;
EMA via exponential weighting; MACD 12/26/9; Bollinger 20/2). Candlestick
pattern checks are body/wick geometry rules on OHLC frames.

All functions are NaN-safe and guard against division by zero on flat
(constant) series.
"""

from __future__ import annotations

from typing import Tuple

import numpy as np
import pandas as pd


def ema(series: pd.Series, period: int) -> pd.Series:
    """Exponential moving average. Equivalent to TradingView's ta.ema."""
    if period <= 0:
        raise ValueError("period must be positive")
    return series.ewm(span=period, adjust=False).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index with Wilder's smoothing (alpha = 1/period).

    Flat series (no gains, no losses) -> neutral 50 instead of 0/0 or NaN.
    """
    if period <= 0:
        raise ValueError("period must be positive")
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    # Guard: where avg_loss == 0 -> RSI = 100 if there were gains else 50 (flat).
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100.0 - 100.0 / (1.0 + rs)
    out = out.where(avg_loss != 0.0)
    # Guard: avg_loss == 0 -> RSI = 100 if there were gains else 50 (flat).
    neutral = pd.Series(np.where(avg_gain > 0.0, 100.0, 50.0), index=series.index)
    out = out.fillna(neutral)
    # Before min_periods there is not enough history -> NaN.
    out.iloc[:period] = np.nan
    return out


def macd(
    series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """MACD line, signal line, histogram (12/26/9 defaults)."""
    if not (0 < fast < slow):
        raise ValueError("require 0 < fast < slow")
    fast_ma = ema(series, fast)
    slow_ma = ema(series, slow)
    line = fast_ma - slow_ma
    sig = line.ewm(span=signal, adjust=False).mean()
    hist = line - sig
    return line, sig, hist


def true_range(df: pd.DataFrame) -> pd.Series:
    """True Range = max(H-L, |H-prevC|, |L-prevC|); first row = H-L."""
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return tr


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average True Range with Wilder's smoothing."""
    if period <= 0:
        raise ValueError("period must be positive")
    tr = true_range(df)
    return tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


def bollinger(
    series: pd.Series, period: int = 20, ndev: float = 2.0
) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """Bollinger Bands (upper, middle, lower).

    Flat series (std == 0): upper == middle == lower == mean (no div-by-zero).
    """
    if period <= 0 or ndev < 0:
        raise ValueError("period must be positive and ndev non-negative")
    mid = series.rolling(period).mean()
    std = series.rolling(period).std(ddof=0)
    upper = mid + ndev * std
    lower = mid - ndev * std
    return upper, mid, lower


# --------------------------------------------------------------------------
# Candlestick patterns — boolean Series aligned with df.index.
# Rules use relative body/wick geometry (standard textbook definitions),
# tolerant of zero-range candles (guards div-by-zero).
# --------------------------------------------------------------------------

def _body(df: pd.DataFrame) -> pd.Series:
    return (df["close"] - df["open"]).abs()


def _range(df: pd.DataFrame) -> pd.Series:
    return df["high"] - df["low"]


def is_bullish_engulfing(df: pd.DataFrame) -> pd.Series:
    """Prev candle bearish, current bullish, current body engulfs prev body."""
    prev_open, prev_close = df["open"].shift(1), df["close"].shift(1)
    body = _body(df)
    prev_body = (prev_close - prev_open).abs()
    cond = (
        (prev_close < prev_open)  # prev bearish
        & (df["close"] > df["open"])  # current bullish
        & (df["close"] >= prev_open)
        & (df["open"] <= prev_close)
        & (body > prev_body)
    )
    return cond.fillna(False)


def is_bearish_engulfing(df: pd.DataFrame) -> pd.Series:
    """Prev candle bullish, current bearish, current body engulfs prev body."""
    prev_open, prev_close = df["open"].shift(1), df["close"].shift(1)
    body = _body(df)
    prev_body = (prev_close - prev_open).abs()
    cond = (
        (prev_close > prev_open)  # prev bullish
        & (df["close"] < df["open"])  # current bearish
        & (df["open"] >= prev_close)
        & (df["close"] <= prev_open)
        & (body > prev_body)
    )
    return cond.fillna(False)


def is_hammer(df: pd.DataFrame) -> pd.Series:
    """Small body at the top of the range, long lower wick (>= 2x body).

    Zero-range candles (doji-flat) never qualify.
    """
    rng = _range(df)
    body = _body(df)
    lower_wick = pd.concat([df["open"], df["close"]], axis=1).min(axis=1) - df["low"]
    upper_wick = df["high"] - pd.concat([df["open"], df["close"]], axis=1).max(axis=1)
    cond = (
        (rng > 0)
        & (lower_wick >= 2.0 * body)
        & (upper_wick <= body)
        & (body <= 0.35 * rng)
    )
    return cond.fillna(False)


def is_shooting_star(df: pd.DataFrame) -> pd.Series:
    """Small body at the bottom of the range, long upper wick (>= 2x body)."""
    rng = _range(df)
    body = _body(df)
    lower_wick = pd.concat([df["open"], df["close"]], axis=1).min(axis=1) - df["low"]
    upper_wick = df["high"] - pd.concat([df["open"], df["close"]], axis=1).max(axis=1)
    cond = (
        (rng > 0)
        & (upper_wick >= 2.0 * body)
        & (lower_wick <= body)
        & (body <= 0.35 * rng)
    )
    return cond.fillna(False)


def is_doji(df: pd.DataFrame) -> pd.Series:
    """Body <= 10% of range; zero-range candles count as flat/doji."""
    rng = _range(df)
    body = _body(df)
    cond = (body <= 0.10 * rng) | (rng <= 0)
    return cond.fillna(False)


PATTERN_FUNCS = {
    "bullish_engulfing": is_bullish_engulfing,
    "bearish_engulfing": is_bearish_engulfing,
    "hammer": is_hammer,
    "shooting_star": is_shooting_star,
    "doji": is_doji,
}


def detect_patterns(df: pd.DataFrame) -> pd.DataFrame:
    """Return a DataFrame of booleans, one column per pattern (last row = latest)."""
    return pd.DataFrame(
        {name: fn(df) for name, fn in PATTERN_FUNCS.items()}, index=df.index
    )
