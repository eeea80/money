"""Backtest fee and slippage input normalization."""

from __future__ import annotations

from typing import Any


DEFAULT_COMMISSION = 0.0005
DEFAULT_SLIPPAGE = 0.0005


def _non_negative_float(value: Any, default: float) -> float:
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return default


def default_commission_if_missing(commission: Any) -> float:
    if commission in (None, ""):
        return DEFAULT_COMMISSION
    return _non_negative_float(commission, DEFAULT_COMMISSION)


def default_slippage_if_missing(slippage: Any) -> float:
    if slippage in (None, ""):
        return DEFAULT_SLIPPAGE
    return _non_negative_float(slippage, DEFAULT_SLIPPAGE)


def parse_rate(value: Any, *, pct_value: Any = None, default: float = 0.0) -> float:
    raw = pct_value if pct_value not in (None, "") else value
    if raw in (None, ""):
        return default
    parsed = _non_negative_float(raw, default)
    return parsed / 100.0 if pct_value not in (None, "") else parsed
