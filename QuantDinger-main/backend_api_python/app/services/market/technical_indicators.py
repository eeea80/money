"""Technical indicator calculations used by market data collection."""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def calculate_indicators(klines: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate local technical indicators for a K-line series."""
    if not klines or len(klines) < 5:
        return {}

    closes = [float(k.get("close", 0)) for k in klines]
    highs = [float(k.get("high", 0)) for k in klines]
    lows = [float(k.get("low", 0)) for k in klines]
    volumes = [float(k.get("volume", 0)) for k in klines]
    if not closes:
        return {}

    current_price = closes[-1]
    indicators: Dict[str, Any] = {}

    if len(closes) >= 15:
        rsi_value = calc_rsi(closes, 14)
        if rsi_value < 30:
            rsi_signal = "oversold"
        elif rsi_value > 70:
            rsi_signal = "overbought"
        else:
            rsi_signal = "neutral"
        indicators["rsi"] = {"value": round(rsi_value, 2), "signal": rsi_signal}

    if len(closes) >= 34:
        macd_raw = calc_macd(closes)
        macd_val = macd_raw.get("MACD", 0)
        macd_sig = macd_raw.get("MACD_signal", 0)
        macd_hist = macd_raw.get("MACD_histogram", 0)
        prev_macd = macd_raw.get("previous_MACD")
        prev_sig = macd_raw.get("previous_MACD_signal")
        cross_event = None
        if prev_macd is not None and prev_sig is not None:
            if prev_macd <= prev_sig and macd_val > macd_sig:
                cross_event = "golden_cross"
            elif prev_macd >= prev_sig and macd_val < macd_sig:
                cross_event = "death_cross"
        if macd_val > macd_sig and macd_hist > 0:
            macd_signal = "bullish"
            macd_trend = cross_event or "bullish_alignment"
        elif macd_val < macd_sig and macd_hist < 0:
            macd_signal = "bearish"
            macd_trend = cross_event or "bearish_alignment"
        else:
            macd_signal = "neutral"
            macd_trend = "consolidating"
        indicators["macd"] = {
            "value": round(macd_val, 6),
            "signal_line": round(macd_sig, 6),
            "histogram": round(macd_hist, 6),
            "signal": macd_signal,
            "trend": macd_trend,
            "cross_event": cross_event,
        }

    ma5 = sum(closes[-5:]) / 5 if len(closes) >= 5 else current_price
    ma10 = sum(closes[-10:]) / 10 if len(closes) >= 10 else current_price
    ma20 = sum(closes[-20:]) / 20 if len(closes) >= 20 else current_price
    if current_price > ma5 > ma10 > ma20:
        ma_trend = "strong_uptrend"
    elif current_price > ma20:
        ma_trend = "uptrend"
    elif current_price < ma5 < ma10 < ma20:
        ma_trend = "strong_downtrend"
    elif current_price < ma20:
        ma_trend = "downtrend"
    else:
        ma_trend = "sideways"

    indicators["moving_averages"] = {
        "ma5": round(ma5, 6),
        "ma10": round(ma10, 6),
        "ma20": round(ma20, 6),
        "trend": ma_trend,
    }

    bb_for_levels = calc_bollinger(closes, 20, 2) if len(closes) >= 20 else {}
    if len(klines) >= 2:
        prev_high = float(klines[-2].get("high", highs[-2]) if len(highs) >= 2 else current_price * 1.02)
        prev_low = float(klines[-2].get("low", lows[-2]) if len(lows) >= 2 else current_price * 0.98)
        prev_close = float(klines[-2].get("close", closes[-2]) if len(closes) >= 2 else current_price)
        pivot = (prev_high + prev_low + prev_close) / 3
        r1 = 2 * pivot - prev_low
        s1 = 2 * pivot - prev_high
        r2 = pivot + (prev_high - prev_low)
        s2 = pivot - (prev_high - prev_low)
    else:
        pivot = current_price
        r1 = r2 = current_price * 1.02
        s1 = s2 = current_price * 0.98

    recent_highs = highs[-20:] if len(highs) >= 20 else highs
    recent_lows = lows[-20:] if len(lows) >= 20 else lows
    swing_high = max(recent_highs) if recent_highs else current_price * 1.05
    swing_low = min(recent_lows) if recent_lows else current_price * 0.95
    bb_upper = bb_for_levels.get("BB_upper", swing_high)
    bb_lower = bb_for_levels.get("BB_lower", swing_low)
    indicators["levels"] = {
        "support": round((s1 + swing_low + bb_lower) / 3, 6),
        "resistance": round((r1 + swing_high + bb_upper) / 3, 6),
        "pivot": round(pivot, 6),
        "s1": round(s1, 6),
        "r1": round(r1, 6),
        "s2": round(s2, 6),
        "r2": round(r2, 6),
        "swing_high": round(swing_high, 6),
        "swing_low": round(swing_low, 6),
        "method": "pivot_swing_bb_avg",
        "kind": "heuristic_estimate",
        "is_estimate": True,
    }

    atr = calc_atr_wilder(klines, period=14) if len(klines) >= 14 else 0.0
    volatility_pct = (atr / current_price * 100) if current_price > 0 and atr > 0 else 0
    if volatility_pct > 5:
        volatility_level = "high"
    elif volatility_pct > 2:
        volatility_level = "medium"
    elif atr > 0:
        volatility_level = "low"
    else:
        volatility_level = "unknown"
    indicators["volatility"] = {
        "level": volatility_level,
        "pct": round(volatility_pct, 2),
        "atr": round(atr, 6),
    }

    atr_stop_loss = current_price - (2 * atr) if atr > 0 else current_price * 0.95
    support_stop = indicators["levels"]["support"]
    suggested_stop_loss = max(atr_stop_loss, support_stop * 0.99)
    atr_take_profit = current_price + (3 * atr) if atr > 0 else current_price * 1.05
    resistance_tp = indicators["levels"]["resistance"]
    suggested_take_profit = min(atr_take_profit, resistance_tp * 1.01)
    risk = current_price - suggested_stop_loss
    reward = suggested_take_profit - current_price
    indicators["trading_levels"] = {
        "suggested_stop_loss": round(suggested_stop_loss, 6),
        "suggested_take_profit": round(suggested_take_profit, 6),
        "risk_reward_ratio": round(reward / risk, 2) if risk > 0 else 0,
        "atr_multiplier_sl": 2.0,
        "atr_multiplier_tp": 3.0,
        "method": "atr_support_resistance",
    }

    if bb_for_levels:
        indicators["bollinger"] = bb_for_levels
    if len(volumes) >= 21:
        # Compare the analyzed bar with the *previous* 20 bars. Including the
        # numerator in its own baseline systematically compresses the ratio.
        avg_vol = sum(volumes[-21:-1]) / 20
        indicators["volume_ratio"] = round(volumes[-1] / avg_vol, 2) if avg_vol > 0 else 1.0
        indicators["volume_ratio_meta"] = {
            "baseline": "previous_20_bars",
            "baseline_bars": 20,
        }
    if len(closes) >= 20:
        high_20 = max(highs[-20:])
        low_20 = min(lows[-20:])
        indicators["price_position"] = round((current_price - low_20) / (high_20 - low_20) * 100, 1) if high_20 > low_20 else 50.0
    indicators["trend"] = ma_trend
    indicators["current_price"] = round(current_price, 6)
    return indicators


def calc_rsi(closes: List[float], period: int = 14) -> float:
    """Calculate Wilder RSI."""
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [delta if delta > 0 else 0.0 for delta in deltas]
    losses = [-delta if delta < 0 else 0.0 for delta in deltas]
    if len(gains) < period:
        return 50.0
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1.0 + rs)), 2)


def ema_series_sma_seed(data: List[float], period: int) -> List[Optional[float]]:
    """Calculate an EMA series seeded with the first period SMA."""
    output: List[Optional[float]] = [None] * len(data)
    if len(data) < period:
        return output
    k = 2.0 / (period + 1)
    output[period - 1] = sum(data[:period]) / period
    for i in range(period, len(data)):
        prev = output[i - 1]
        if prev is None:
            break
        output[i] = (data[i] - prev) * k + prev
    return output


def calc_macd(closes: List[float]) -> Dict[str, Any]:
    """Calculate MACD(12, 26, 9)."""
    ema12 = ema_series_sma_seed(closes, 12)
    ema26 = ema_series_sma_seed(closes, 26)
    if len(closes) < 26 or ema12[-1] is None or ema26[-1] is None:
        return {"MACD": 0.0, "MACD_signal": 0.0, "MACD_histogram": 0.0}

    macd_sub = [ema12[i] - ema26[i] for i in range(25, len(closes)) if ema12[i] is not None and ema26[i] is not None]
    if not macd_sub:
        return {"MACD": 0.0, "MACD_signal": 0.0, "MACD_histogram": 0.0}
    sig_series = ema_series_sma_seed(macd_sub, 9)
    last_macd = macd_sub[-1]
    last_sig = sig_series[-1] if sig_series[-1] is not None else last_macd
    result: Dict[str, Any] = {
        "MACD": round(last_macd, 6),
        "MACD_signal": round(last_sig, 6),
        "MACD_histogram": round(last_macd - last_sig, 6),
    }
    if len(macd_sub) >= 2 and len(sig_series) >= 2 and sig_series[-2] is not None:
        previous_macd = macd_sub[-2]
        previous_signal = sig_series[-2]
        result.update({
            "previous_MACD": round(previous_macd, 6),
            "previous_MACD_signal": round(previous_signal, 6),
            "previous_MACD_histogram": round(previous_macd - previous_signal, 6),
        })
    return result


def true_ranges(klines: List[Dict[str, Any]]) -> List[float]:
    """Calculate true range for each K-line."""
    ranges: List[float] = []
    for i, kline in enumerate(klines):
        high = float(kline.get("high", 0))
        low = float(kline.get("low", 0))
        if high <= 0 or low <= 0:
            ranges.append(0.0)
            continue
        if i == 0:
            ranges.append(high - low)
        else:
            prev_close = float(klines[i - 1].get("close", 0))
            ranges.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
    return ranges


def calc_atr_wilder(klines: List[Dict[str, Any]], period: int = 14) -> float:
    """Calculate Wilder ATR."""
    ranges = true_ranges(klines)
    if len(ranges) < period:
        return 0.0
    atr = sum(ranges[:period]) / period
    for i in range(period, len(ranges)):
        atr = (atr * (period - 1) + ranges[i]) / period
    return atr


def calc_bollinger(closes: List[float], period: int = 20, std_dev: int = 2) -> Dict[str, float]:
    """Calculate Bollinger Bands."""
    if len(closes) < period:
        return {}
    recent = closes[-period:]
    middle = sum(recent) / period
    variance = sum((value - middle) ** 2 for value in recent) / period
    std = variance ** 0.5
    return {
        "BB_upper": round(middle + std_dev * std, 4),
        "BB_middle": round(middle, 4),
        "BB_lower": round(middle - std_dev * std, 4),
        "BB_width": round((std_dev * std * 2) / middle * 100, 2) if middle > 0 else 0,
    }
