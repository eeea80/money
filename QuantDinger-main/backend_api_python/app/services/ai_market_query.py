"""Deterministic market-query planning and technical evidence for AI Copilot.

The LLM may contribute validated semantic hints, but it never calculates market
numbers. One structured plan drives data fetching, derived indicators,
completeness checks, caching and the final explanation context.
"""
from __future__ import annotations

import math
import re
import statistics
from datetime import datetime, timezone
from typing import Any, Iterable


SUPPORTED_TIMEFRAMES = ("1m", "3m", "5m", "15m", "30m", "1H", "4H", "1D", "1W")
TIMEFRAME_SECONDS = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1H": 3600,
    "4H": 14400,
    "1D": 86400,
    "1W": 604800,
}

ALLOWED_TASKS = {
    "quote",
    "performance",
    "comparison",
    "indicator_analysis",
    "support_resistance",
    "breakout_analysis",
    "market_diagnosis",
}
ALLOWED_METRICS = {
    "price",
    "returns",
    "realized_volatility",
    "volume_ratio",
    "trend",
    "ema20",
    "ema60",
    "ema200",
    "rsi14",
    "macd",
    "bollinger20",
    "atr14",
    "support_resistance",
    "breakout",
}
METRIC_LOOKBACK = {
    "price": 1,
    "returns": 21,
    "realized_volatility": 31,
    "volume_ratio": 21,
    "trend": 80,
    "ema20": 40,
    "ema60": 100,
    "ema200": 240,
    "rsi14": 100,
    "macd": 120,
    "bollinger20": 60,
    "atr14": 60,
    "support_resistance": 120,
    "breakout": 120,
}

_METRIC_PATTERNS: tuple[tuple[str, str], ...] = (
    ("rsi14", r"(?<![a-z0-9])rsi(?![a-z0-9])|相对强弱|超买|超卖"),
    ("macd", r"(?<![a-z0-9])macd(?![a-z0-9])|金叉|死叉|柱体|dif|dea"),
    ("bollinger20", r"boll(?:inger)?|布林|上轨|下轨|中轨"),
    ("ema200", r"(?:ema|指数均线)\s*200|200\s*(?:日|周期)?均线"),
    ("ema60", r"(?:ema|指数均线)\s*60|60\s*(?:日|周期)?均线"),
    ("ema20", r"(?:ema|指数均线)\s*20|20\s*(?:日|周期)?均线|均线|moving average"),
    ("atr14", r"(?<![a-z0-9])atr(?![a-z0-9])|真实波幅|波动区间"),
    ("volume_ratio", r"成交量|交易量|放量|缩量|量价|volume|turnover"),
    ("support_resistance", r"支撑|阻力|压力位|关键位|前高|前低|回踩|承压|support|resistance|level"),
    ("breakout", r"突破|上破|冲破|站上|站稳|破位|跌破|失守|新高|新低|breakout|breakdown|clear(?:ed)?\s+(?:the\s+)?(?:high|resistance)"),
    ("realized_volatility", r"波动率|振幅|volatility"),
    ("returns", r"收益|涨幅|跌幅|表现|回报|return|performance|change"),
    ("trend", r"趋势|强弱|多头|空头|走势|trend|momentum"),
    ("price", r"当前价|现价|实时价格|多少钱|股价|报价|current price|live price|quote"),
)


def _unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out


def normalize_timeframe(value: Any) -> str:
    raw = str(value or "").strip()
    lower = raw.lower().replace(" ", "")
    aliases = {
        "1m": "1m", "1min": "1m", "1分钟": "1m",
        "3m": "3m", "3min": "3m", "3分钟": "3m",
        "5m": "5m", "5min": "5m", "5分钟": "5m",
        "15m": "15m", "15min": "15m", "15分钟": "15m",
        "30m": "30m", "30min": "30m", "30分钟": "30m",
        "1h": "1H", "1hour": "1H", "1小时": "1H", "一小时": "1H",
        "4h": "4H", "4hour": "4H", "4小时": "4H", "四小时": "4H",
        "1d": "1D", "1day": "1D", "日线": "1D", "每天": "1D", "daily": "1D",
        "1w": "1W", "1week": "1W", "周线": "1W", "weekly": "1W",
    }
    return aliases.get(lower, raw if raw in SUPPORTED_TIMEFRAMES else "")


def extract_timeframes(message: str) -> list[str]:
    text = message or ""
    matches: list[tuple[int, str]] = []
    patterns = (
        (r"(?<![a-z0-9])(1|3|5|15|30)\s*(?:m|min|minute)(?![a-z0-9])", lambda m: f"{m.group(1)}m"),
        (r"(?<![a-z0-9])(1|4)\s*(?:h|hour)(?![a-z0-9])", lambda m: f"{m.group(1)}H"),
        (r"(?<![a-z0-9])1\s*(?:d|day)(?![a-z0-9])", lambda _m: "1D"),
        (r"(?<![a-z0-9])1\s*(?:w|week)(?![a-z0-9])", lambda _m: "1W"),
        (r"(1|3|5|15|30)\s*分钟", lambda m: f"{m.group(1)}m"),
        (r"(?:1\s*小时|一小时)", lambda _m: "1H"),
        (r"(?:4\s*小时|四小时)", lambda _m: "4H"),
        (r"日线|交易日|\d+\s*(?:日|天)|daily|days?", lambda _m: "1D"),
        (r"周线|weekly|weeks?", lambda _m: "1W"),
    )
    for pattern, mapper in patterns:
        for match in re.finditer(pattern, text, re.I):
            timeframe = normalize_timeframe(mapper(match))
            if timeframe:
                matches.append((match.start(), timeframe))
    return _unique(timeframe for _, timeframe in sorted(matches, key=lambda item: item[0]))


def _detected_metrics(message: str) -> list[str]:
    text = message or ""
    return _unique(metric for metric, pattern in _METRIC_PATTERNS if re.search(pattern, text, re.I))


def _return_horizons(message: str) -> list[int]:
    matches: list[tuple[int, int]] = []
    patterns = (
        r"(?:最近|近|过去|前)\s*(\d+)\s*(?:个)?交易日",
        r"(?:last|past|previous)\s+(\d+)\s+(?:trading\s+)?days?",
    )
    for pattern in patterns:
        for match in re.finditer(pattern, message or "", re.I):
            value = int(match.group(1))
            if 1 <= value <= 60:
                matches.append((match.start(), value))
    return [int(value) for value in _unique(str(value) for _, value in sorted(matches))]


def _task_from_text(message: str, instrument_count: int, metrics: list[str]) -> str:
    text = message or ""
    if instrument_count >= 2 or re.search(r"比较|对比|排名|哪个更|孰强|versus|\bvs\.?\b|compare|rank", text, re.I):
        return "comparison"
    if "breakout" in metrics:
        return "breakout_analysis"
    if "support_resistance" in metrics:
        return "support_resistance"
    if any(metric in metrics for metric in ("rsi14", "macd", "bollinger20", "ema20", "ema60", "ema200", "atr14")):
        return "indicator_analysis"
    if metrics == ["price"]:
        return "quote"
    if any(metric in metrics for metric in ("returns", "realized_volatility", "volume_ratio")):
        return "performance"
    return "market_diagnosis"


def build_market_query_plan(
    message: str,
    context: dict | None = None,
    instruments: list[dict] | None = None,
    semantic_hints: dict | None = None,
) -> dict:
    context = context or {}
    instruments = [
        {
            "market": str(item.get("market") or ""),
            "symbol": str(item.get("symbol") or ""),
            "name": str(item.get("name") or item.get("symbol") or ""),
        }
        for item in (instruments or [])
        if item.get("market") and item.get("symbol")
    ]
    hints = semantic_hints if isinstance(semantic_hints, dict) else {}
    deterministic_metrics = _detected_metrics(message)
    hinted_metrics = [str(item) for item in hints.get("metrics") or [] if str(item) in ALLOWED_METRICS]
    metrics = _unique([*deterministic_metrics, *hinted_metrics])
    hinted_task = str(hints.get("market_task") or "")
    task = _task_from_text(message, len(instruments), metrics)
    if hinted_task in ALLOWED_TASKS and task == "market_diagnosis":
        task = hinted_task

    defaults = {
        "quote": ["price"],
        "performance": ["returns", "realized_volatility", "volume_ratio", "trend"],
        "comparison": ["returns", "realized_volatility", "volume_ratio", "trend"],
        "indicator_analysis": ["trend", "rsi14", "macd", "atr14"],
        "support_resistance": ["price", "atr14", "support_resistance", "trend"],
        "breakout_analysis": ["price", "atr14", "volume_ratio", "support_resistance", "breakout", "trend", "macd"],
        "market_diagnosis": ["price", "returns", "volume_ratio", "trend", "rsi14", "macd", "atr14", "support_resistance"],
    }
    # Explicit questions should not silently expand into a much larger generic
    # diagnosis. Only structural studies add their required dependencies.
    if task in {"breakout_analysis", "support_resistance"}:
        metrics = _unique([*metrics, *defaults[task]])
    elif not metrics:
        metrics = list(defaults[task])
    elif task == "quote" and "price" not in metrics:
        metrics.insert(0, "price")

    timeframes = extract_timeframes(message)
    if not timeframes:
        hinted_timeframes = [normalize_timeframe(item) for item in hints.get("analysis_timeframes") or []]
        timeframes = [item for item in hinted_timeframes if item]
    if not timeframes:
        selected = normalize_timeframe(context.get("timeframe") or context.get("selected_timeframe"))
        timeframes = [selected] if selected else ([] if task == "quote" else ["1D"])

    temporal_live_hint = bool(re.search(r"现在|当前|此刻|实时|最新|目前|now|current|live|latest", message or "", re.I))
    needs_live_price = (
        task == "quote"
        or "price" in deterministic_metrics
        or (temporal_live_hint and "price" in metrics)
        or bool(hints.get("needs_live_price"))
    )
    if task != "quote" and not timeframes:
        timeframes = ["1D"]
    lookback = max((METRIC_LOOKBACK.get(metric, 1) for metric in metrics), default=1)
    return_horizons = _return_horizons(message)
    if "returns" in metrics and return_horizons:
        lookback = max(lookback, max(return_horizons) + 1)
    lookback = max(5, min(300, lookback)) if timeframes else 0
    close_only = task not in {"quote"}
    confidence = 95 if deterministic_metrics or extract_timeframes(message) else (75 if hinted_metrics else 65)
    ambiguities = []
    if task != "quote" and not extract_timeframes(message) and not context.get("timeframe"):
        ambiguities.append("No timeframe was explicit; defaulted to 1D.")

    return {
        "version": "market-query-plan-v1",
        "task": task,
        "instruments": instruments,
        "timeframes": timeframes,
        "metrics": metrics,
        "parameters": {
            "return_horizons": return_horizons or ([1, 5, 20] if "returns" in metrics else []),
            "volatility_window": 20 if "realized_volatility" in metrics else None,
            "breakout_volume_threshold": 1.2 if "breakout" in metrics else None,
        },
        "lookback": lookback,
        "closed_candle_only": close_only,
        "include_live_price": needs_live_price,
        "force_price_refresh": False,
        "freshness": "live" if task == "quote" else "recent_cached",
        "exchange_id": str(context.get("exchange_id") or context.get("exchangeId") or ""),
        "market_type": str(context.get("market_type") or context.get("marketType") or ""),
        "confidence": confidence,
        "ambiguities": ambiguities,
        "semantic_hints_used": bool(hinted_metrics or hinted_task in ALLOWED_TASKS),
    }


def snapshot_options_from_plan(plan: dict) -> dict:
    return {
        "snapshot_timeframes": list(plan.get("timeframes") or []),
        "snapshot_limit": int(plan.get("lookback") or 120),
        "include_price": bool(plan.get("include_live_price")),
        "force_price_refresh": bool(plan.get("force_price_refresh")),
        "exchange_id": plan.get("exchange_id") or "",
        "market_type": plan.get("market_type") or "",
        "market_query_plan": plan,
        "skip_klines": not bool(plan.get("timeframes")),
    }


def _to_float(value: Any) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _bar_time(value: Any) -> float | None:
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    try:
        number = float(value)
        return number / 1000 if number > 10_000_000_000 else number
    except (TypeError, ValueError):
        pass
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except (TypeError, ValueError):
        return None


def clean_ohlcv(klines: list[dict]) -> list[dict]:
    rows = []
    for row in klines or []:
        close = _to_float(row.get("close"))
        high = _to_float(row.get("high"))
        low = _to_float(row.get("low"))
        open_ = _to_float(row.get("open"))
        volume = _to_float(row.get("volume") if row.get("volume") is not None else row.get("vol"))
        if close is None or high is None or low is None:
            continue
        rows.append({
            "time": row.get("time"),
            "open": open_ if open_ is not None else close,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        })
    rows.sort(key=lambda item: _bar_time(item.get("time")) or 0)
    return rows


def closed_ohlcv(klines: list[dict], timeframe: str, now_ts: float | None = None) -> tuple[list[dict], bool]:
    rows = clean_ohlcv(klines)
    if not rows:
        return rows, False
    seconds = TIMEFRAME_SECONDS.get(normalize_timeframe(timeframe))
    last_ts = _bar_time(rows[-1].get("time"))
    now_ts = float(now_ts or datetime.now(timezone.utc).timestamp())
    forming = bool(seconds and last_ts is not None and last_ts + seconds > now_ts)
    return (rows[:-1] if forming else rows), forming


def _ema_series(values: list[float], period: int) -> list[float | None]:
    result: list[float | None] = [None] * len(values)
    if period < 1 or len(values) < period:
        return result
    result[period - 1] = sum(values[:period]) / period
    multiplier = 2.0 / (period + 1.0)
    for index in range(period, len(values)):
        previous = result[index - 1]
        result[index] = (values[index] - float(previous)) * multiplier + float(previous)
    return result


def _rsi(values: list[float], period: int = 14) -> float | None:
    if len(values) <= period:
        return None
    gains = [max(values[i] - values[i - 1], 0.0) for i in range(1, len(values))]
    losses = [max(values[i - 1] - values[i], 0.0) for i in range(1, len(values))]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for index in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[index]) / period
        avg_loss = (avg_loss * (period - 1) + losses[index]) / period
    if avg_loss == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)


def _atr(rows: list[dict], period: int = 14) -> float | None:
    if len(rows) < 2:
        return None
    ranges = []
    for index in range(1, len(rows)):
        row = rows[index]
        previous_close = rows[index - 1]["close"]
        ranges.append(max(row["high"] - row["low"], abs(row["high"] - previous_close), abs(row["low"] - previous_close)))
    return sum(ranges[-period:]) / min(period, len(ranges)) if ranges else None


def _macd(values: list[float]) -> dict:
    fast = _ema_series(values, 12)
    slow = _ema_series(values, 26)
    line: list[float | None] = [
        (float(fast[index]) - float(slow[index])) if fast[index] is not None and slow[index] is not None else None
        for index in range(len(values))
    ]
    valid_line = [value for value in line if value is not None]
    signal_valid = _ema_series(valid_line, 9)
    signal: list[float | None] = [None] * len(values)
    valid_index = 0
    for index, value in enumerate(line):
        if value is not None:
            signal[index] = signal_valid[valid_index]
            valid_index += 1
    if not line or line[-1] is None or signal[-1] is None:
        return {"available": False}
    histogram = float(line[-1]) - float(signal[-1])
    previous_histogram = None
    if len(line) >= 2 and line[-2] is not None and signal[-2] is not None:
        previous_histogram = float(line[-2]) - float(signal[-2])
    crossover = "none"
    if previous_histogram is not None:
        if previous_histogram <= 0 < histogram:
            crossover = "bullish_cross"
        elif previous_histogram >= 0 > histogram:
            crossover = "bearish_cross"
    return {
        "available": True,
        "line": round(float(line[-1]), 8),
        "signal": round(float(signal[-1]), 8),
        "histogram": round(histogram, 8),
        "previous_histogram": round(previous_histogram, 8) if previous_histogram is not None else None,
        "crossover": crossover,
        "momentum": "bullish" if histogram > 0 else ("bearish" if histogram < 0 else "neutral"),
    }


def _pivot_levels(rows: list[dict], latest_close: float, atr: float | None) -> dict:
    history = rows[-121:-1] if len(rows) > 1 else []
    if len(history) < 5:
        return {"available": False, "supports": [], "resistances": []}
    pivot_highs: list[float] = []
    pivot_lows: list[float] = []
    for index in range(2, len(history) - 2):
        row = history[index]
        if row["high"] >= max(history[index + offset]["high"] for offset in (-2, -1, 1, 2)):
            pivot_highs.append(row["high"])
        if row["low"] <= min(history[index + offset]["low"] for offset in (-2, -1, 1, 2)):
            pivot_lows.append(row["low"])
    prior_high = max(row["high"] for row in history)
    prior_low = min(row["low"] for row in history)
    tolerance = max((atr or 0.0) * 0.35, latest_close * 0.002)

    def cluster(values: list[float]) -> list[dict]:
        groups: list[list[float]] = []
        for value in sorted(values):
            target = next((group for group in groups if abs(value - sum(group) / len(group)) <= tolerance), None)
            if target is None:
                groups.append([value])
            else:
                target.append(value)
        return [
            {"price": round(sum(group) / len(group), 8), "touches": len(group)}
            for group in groups
        ]

    support_candidates = cluster([*pivot_lows, prior_low])
    resistance_candidates = cluster([*pivot_highs, prior_high])
    supports = sorted(
        (item for item in support_candidates if item["price"] <= latest_close + tolerance),
        key=lambda item: (abs(latest_close - item["price"]), -item["touches"]),
    )[:3]
    resistances = sorted(
        (item for item in resistance_candidates if item["price"] >= latest_close - tolerance),
        key=lambda item: (abs(item["price"] - latest_close), -item["touches"]),
    )[:3]
    return {
        "available": True,
        "prior_high": round(prior_high, 8),
        "prior_low": round(prior_low, 8),
        "tolerance": round(tolerance, 8),
        "supports": supports,
        "resistances": resistances,
        "history_bars": len(history),
        "excludes_signal_candle": True,
    }


def compute_technical_evidence(
    klines: list[dict],
    timeframe: str,
    metrics: list[str] | None = None,
    *,
    closed_candle_only: bool = True,
    now_ts: float | None = None,
    parameters: dict | None = None,
    market: str = "",
) -> dict:
    all_rows = clean_ohlcv(klines)
    closed_rows, forming_excluded = closed_ohlcv(klines, timeframe, now_ts=now_ts)
    rows = closed_rows if closed_candle_only else all_rows
    requested = [metric for metric in (metrics or []) if metric in ALLOWED_METRICS]
    parameters = parameters if isinstance(parameters, dict) else {}
    return_horizons = [
        int(value) for value in parameters.get("return_horizons") or [1, 5, 20]
        if isinstance(value, (int, float)) and 1 <= int(value) <= 60
    ]
    result = {
        "timeframe": normalize_timeframe(timeframe) or timeframe,
        "available": len(rows) >= 2,
        "bars_total": len(all_rows),
        "bars_used": len(rows),
        "closed_candle_only": closed_candle_only,
        "forming_candle_excluded": bool(forming_excluded and closed_candle_only),
        "latest_closed_time": rows[-1].get("time") if rows else None,
        "metrics": {},
        "metric_metadata": {},
        "missing_metrics": [],
    }
    if len(rows) < 2:
        result["missing_metrics"] = requested
        return result

    closes = [row["close"] for row in rows]
    latest = rows[-1]
    atr = _atr(rows, 14)
    latest_volume = latest.get("volume")
    prior_volumes = [row["volume"] for row in rows[-21:-1] if row.get("volume") is not None]
    volume_average = sum(prior_volumes) / len(prior_volumes) if prior_volumes else None
    volume_ratio = (latest_volume / volume_average) if latest_volume is not None and volume_average else None
    ema20 = _ema_series(closes, 20)[-1]
    ema60 = _ema_series(closes, 60)[-1]
    ema200 = _ema_series(closes, 200)[-1]
    trend = "neutral"
    if ema20 is not None and ema60 is not None:
        if latest["close"] > ema20 > ema60:
            trend = "bullish"
        elif latest["close"] < ema20 < ema60:
            trend = "bearish"

    values: dict[str, Any] = {
        "price": round(latest["close"], 8),
        "returns": {
            f"{period}_bar_pct": round((closes[-1] / closes[-period - 1] - 1) * 100, 4) if len(closes) > period else None
            for period in return_horizons
        },
        "realized_volatility": None,
        "volume_ratio": round(volume_ratio, 4) if volume_ratio is not None else None,
        "trend": trend,
        "ema20": round(float(ema20), 8) if ema20 is not None else None,
        "ema60": round(float(ema60), 8) if ema60 is not None else None,
        "ema200": round(float(ema200), 8) if ema200 is not None else None,
        "rsi14": None,
        "macd": _macd(closes),
        "bollinger20": None,
        "atr14": round(float(atr), 8) if atr is not None else None,
    }
    returns = [closes[index] / closes[index - 1] - 1 for index in range(1, len(closes)) if closes[index - 1]]
    if len(returns) >= 20:
        normalized_timeframe = normalize_timeframe(timeframe)
        seconds = TIMEFRAME_SECONDS.get(normalized_timeframe, 86400)
        stock_market = str(market or "").lower() in {"usstock", "hkstock", "cnstock"}
        if normalized_timeframe == "1W":
            periods_per_year = 52
        elif stock_market:
            periods_per_year = 252 if seconds >= 86400 else max(252, round(252 * 23400 / seconds))
        else:
            periods_per_year = max(1, round(365 * 86400 / seconds))
        values["realized_volatility"] = round(statistics.stdev(returns[-20:]) * math.sqrt(periods_per_year) * 100, 4)
        result["metric_metadata"]["realized_volatility"] = {
            "unit": "annualized_percent",
            "window_bars": 20,
            "periods_per_year": periods_per_year,
        }
    result["metric_metadata"]["returns"] = {"unit": "percent", "horizons_bars": return_horizons}
    result["metric_metadata"]["volume_ratio"] = {"unit": "multiple", "baseline": "previous_20_closed_bars"}
    rsi = _rsi(closes, 14)
    values["rsi14"] = round(rsi, 4) if rsi is not None else None
    if len(closes) >= 20:
        window = closes[-20:]
        middle = sum(window) / 20
        deviation = statistics.pstdev(window)
        values["bollinger20"] = {
            "middle": round(middle, 8),
            "upper": round(middle + 2 * deviation, 8),
            "lower": round(middle - 2 * deviation, 8),
            "position": round((latest["close"] - (middle - 2 * deviation)) / (4 * deviation), 4) if deviation else 0.5,
        }

    levels = _pivot_levels(rows, latest["close"], atr)
    values["support_resistance"] = levels
    breakout = {"available": False, "status": "insufficient_history"}
    if levels.get("available"):
        prior_high = float(levels["prior_high"])
        prior_low = float(levels["prior_low"])
        tolerance = float(levels["tolerance"])
        upward = latest["close"] > prior_high + tolerance
        downward = latest["close"] < prior_low - tolerance
        volume_threshold = float(parameters.get("breakout_volume_threshold") or 1.2)
        volume_confirmed = volume_ratio is not None and volume_ratio >= volume_threshold
        status = "range"
        if upward:
            status = "confirmed_up" if volume_confirmed else "unconfirmed_up"
        elif downward:
            status = "confirmed_down" if volume_confirmed else "unconfirmed_down"
        breakout = {
            "available": True,
            "status": status,
            "direction": "up" if upward else ("down" if downward else "none"),
            "close_confirmed": bool(upward or downward),
            "volume_confirmed": volume_confirmed,
            "volume_ratio": round(volume_ratio, 4) if volume_ratio is not None else None,
            "volume_threshold": volume_threshold,
            "reference_high": round(prior_high, 8),
            "reference_low": round(prior_low, 8),
            "tolerance": round(tolerance, 8),
            "signal_close": round(latest["close"], 8),
            "uses_closed_candle": closed_candle_only,
            "reference_excludes_signal_candle": True,
        }
    values["breakout"] = breakout

    for metric in requested:
        value = values.get(metric)
        dictionary_incomplete = (
            isinstance(value, dict)
            and (
                value.get("available") is False
                or (metric == "returns" and (not value or any(item is None for item in value.values())))
            )
        )
        if value is None or dictionary_incomplete:
            result["missing_metrics"].append(metric)
        else:
            result["metrics"][metric] = value
    result["complete"] = not result["missing_metrics"]
    return result


def evaluate_plan_completeness(plan: dict, snapshots: list[dict]) -> dict:
    missing: list[dict] = []
    for instrument in plan.get("instruments") or []:
        key = f"{instrument.get('market')}:{str(instrument.get('symbol') or '').upper()}"
        snapshot = next(
            (
                item for item in snapshots
                if f"{item.get('market')}:{str(item.get('symbol') or '').upper()}" == key
            ),
            None,
        )
        if not snapshot:
            missing.append({"instrument": instrument, "reason": "snapshot_missing", "metrics": plan.get("metrics") or []})
            continue
        if plan.get("task") == "quote":
            if not (snapshot.get("price") or {}).get("last"):
                missing.append({"instrument": instrument, "reason": "live_price_missing", "metrics": ["price"]})
            continue
        for timeframe in plan.get("timeframes") or []:
            frame = (snapshot.get("timeframes") or {}).get(timeframe) or {}
            technical = frame.get("technical") if isinstance(frame.get("technical"), dict) else {}
            if not frame.get("available"):
                missing.append({"instrument": instrument, "timeframe": timeframe, "reason": "ohlcv_missing", "metrics": plan.get("metrics") or []})
            elif not technical:
                missing.append({"instrument": instrument, "timeframe": timeframe, "reason": "technical_evidence_missing", "metrics": plan.get("metrics") or []})
            elif technical.get("missing_metrics"):
                missing.append({
                    "instrument": instrument,
                    "timeframe": timeframe,
                    "reason": "metric_history_insufficient",
                    "metrics": technical.get("missing_metrics"),
                })
            else:
                present = set((technical.get("metrics") or {}).keys())
                absent = [metric for metric in plan.get("metrics") or [] if metric not in present]
                if absent:
                    missing.append({
                        "instrument": instrument,
                        "timeframe": timeframe,
                        "reason": "technical_metric_missing",
                        "metrics": absent,
                    })
    return {
        "complete": not missing,
        "requested_instruments": len(plan.get("instruments") or []),
        "requested_timeframes": list(plan.get("timeframes") or []),
        "requested_metrics": list(plan.get("metrics") or []),
        "missing": missing,
    }
