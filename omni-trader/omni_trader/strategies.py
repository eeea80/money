"""Pluggable strategy interface + the first strategy (EMA cross with RSI filter).

A strategy is a pure function of a closed-candle DataFrame -> StrategySignal.
Register new strategies with @register_strategy and they become available
to the engine by name.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Type

import pandas as pd

from . import indicators as ind


class Signal(str, Enum):
    LONG = "long"
    SHORT = "short"
    FLAT = "flat"


@dataclass
class StrategySignal:
    """One strategy evaluation on the latest closed candle."""

    strategy: str
    signal: Signal
    price: float
    timestamp: pd.Timestamp
    reasons: List[str] = field(default_factory=list)


class Strategy:
    """Base class: subclasses implement `generate` (pure, no side effects)."""

    name: str = "base"
    params: Dict = {}

    def generate(self, df: pd.DataFrame) -> StrategySignal:
        raise NotImplementedError


_REGISTRY: Dict[str, Type[Strategy]] = {}


def register_strategy(cls: Type[Strategy]) -> Type[Strategy]:
    _REGISTRY[cls.name] = cls
    return cls


def get_strategy(name: str, **params) -> Strategy:
    try:
        cls = _REGISTRY[name]
    except KeyError as exc:
        raise KeyError(
            f"unknown strategy {name!r}; registered: {sorted(_REGISTRY)}"
        ) from exc
    merged = dict(cls.params)
    merged.update(params)
    return cls(**merged)


def registered_strategies() -> List[str]:
    return sorted(_REGISTRY)


# ---------------------------------------------------------------------------
# First strategy: EMA cross (fast/slow) with an RSI filter.
#   LONG  when fast EMA crosses above slow EMA and RSI is not overbought.
#   SHORT when fast EMA crosses below slow EMA and RSI is not oversold.
#   FLAT  otherwise. Patterns are evaluated and appended to reasons for
#         the (later-phase) AI advisor to annotate.
# ---------------------------------------------------------------------------


@register_strategy
class EmaCrossRsiStrategy(Strategy):
    name = "ema_cross_rsi"
    params = {
        "fast": 12,
        "slow": 26,
        "rsi_period": 14,
        "rsi_overbought": 70.0,
        "rsi_oversold": 30.0,
        "use_patterns": True,
    }

    def __init__(self, **params) -> None:
        self.params = dict(self.params)
        self.params.update(params)
        p = self.params
        self.fast: int = int(p["fast"])
        self.slow: int = int(p["slow"])
        self.rsi_period: int = int(p["rsi_period"])
        self.rsi_overbought: float = float(p["rsi_overbought"])
        self.rsi_oversold: float = float(p["rsi_oversold"])
        self.use_patterns: bool = bool(p["use_patterns"])

    def generate(self, df: pd.DataFrame) -> StrategySignal:
        if len(df) < self.slow + 2:
            return StrategySignal(
                self.name, Signal.FLAT, float(df["close"].iloc[-1]),
                df.index[-1], ["insufficient history"]
            )

        close = df["close"]
        ema_fast = ind.ema(close, self.fast)
        ema_slow = ind.ema(close, self.slow)
        rsi_now = ind.rsi(close, self.rsi_period)

        cross_up = (
            ema_fast.iloc[-2] <= ema_slow.iloc[-2]
            and ema_fast.iloc[-1] > ema_slow.iloc[-1]
        )
        cross_down = (
            ema_fast.iloc[-2] >= ema_slow.iloc[-2]
            and ema_fast.iloc[-1] < ema_slow.iloc[-1]
        )

        rsi_last = float(rsi_now.iloc[-1])
        signal, reasons = Signal.FLAT, []

        if cross_up and rsi_last < self.rsi_overbought:
            signal = Signal.LONG
            reasons = [
                f"EMA{self.fast} crossed above EMA{self.slow}",
                f"RSI {rsi_last:.1f} < {self.rsi_overbought:.0f} (not overbought)",
            ]
        elif cross_down and rsi_last > self.rsi_oversold:
            signal = Signal.SHORT
            reasons = [
                f"EMA{self.fast} crossed below EMA{self.slow}",
                f"RSI {rsi_last:.1f} > {self.rsi_oversold:.0f} (not oversold)",
            ]
        else:
            trend = "up" if ema_fast.iloc[-1] > ema_slow.iloc[-1] else "down"
            reasons = [
                f"no fresh crossover (EMA trend {trend})",
                f"RSI {rsi_last:.1f}",
            ]

        if self.use_patterns:
            patterns = ind.detect_patterns(df.tail(3))
            latest = patterns.iloc[-1]
            fired = [name for name, hit in latest.items() if bool(hit)]
            if fired:
                reasons.append("patterns: " + ", ".join(fired))

        return StrategySignal(
            self.name, signal, float(close.iloc[-1]), df.index[-1], reasons
        )
