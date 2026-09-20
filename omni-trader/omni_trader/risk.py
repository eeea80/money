"""Risk manager — Conservative / Balanced / Aggressive modes.

Rules (hard, by design):
- Fixed-fraction sizing: risk per trade = 0.5% / 1% / 2% of current equity.
- Daily loss cap: when the day's realized PnL falls below -cap, trading is
  halted for the rest of the calendar day (UTC).
- Drawdown throttle: position size is scaled down as drawdown from peak
  equity grows. The factor only ever decreases while underwater —
  NO martingale, NO loss-chasing, NO size increase after losses.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional


class RiskMode(str, Enum):
    CONSERVATIVE = "conservative"
    BALANCED = "balanced"
    AGGRESSIVE = "aggressive"


RISK_PER_TRADE: Dict[RiskMode, float] = {
    RiskMode.CONSERVATIVE: 0.005,  # 0.5%
    RiskMode.BALANCED: 0.01,       # 1.0%
    RiskMode.AGGRESSIVE: 0.02,     # 2.0%
}

DAILY_LOSS_CAP: Dict[RiskMode, float] = {
    RiskMode.CONSERVATIVE: 0.02,   # -2% of day-start equity
    RiskMode.BALANCED: 0.03,       # -3%
    RiskMode.AGGRESSIVE: 0.05,     # -5%
}

# Drawdown -> size multiplier. Monotonically decreasing in drawdown.
# Once a tier is hit it stays until equity recovers above the tier line.
DRAWDOWN_TIERS: List[tuple] = [
    (0.05, 1.00),   # dd < 5%  -> full size
    (0.10, 0.70),   # dd < 10% -> 70%
    (0.15, 0.50),   # dd < 15% -> 50%
    (float("inf"), 0.25),  # dd >= 15% -> 25%
]


@dataclass
class RiskState:
    equity: float
    peak_equity: float
    day_start_equity: float
    day_key: str
    daily_pnl: float = 0.0
    halted: bool = False
    throttle: float = 1.0
    trades_today: int = 0


class RiskManager:
    """Thread-safe risk gate for one trading process."""

    def __init__(
        self,
        starting_equity: float = 10_000.0,
        mode: RiskMode | str = RiskMode.BALANCED,
    ) -> None:
        if starting_equity <= 0:
            raise ValueError("starting_equity must be positive")
        self._lock = threading.RLock()
        self.mode = RiskMode(mode)
        now = datetime.now(timezone.utc)
        self.state = RiskState(
            equity=starting_equity,
            peak_equity=starting_equity,
            day_start_equity=starting_equity,
            day_key=now.strftime("%Y-%m-%d"),
        )

    # -- helpers ---------------------------------------------------------
    @staticmethod
    def _today() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    @property
    def risk_per_trade(self) -> float:
        return RISK_PER_TRADE[self.mode]

    @property
    def daily_loss_cap(self) -> float:
        return DAILY_LOSS_CAP[self.mode]

    def _roll_day_if_needed_locked(self) -> None:
        today = self._today()
        st = self.state
        if today != st.day_key:
            st.day_key = today
            st.day_start_equity = st.equity
            st.daily_pnl = 0.0
            st.trades_today = 0
            st.halted = False  # new trading day lifts the halt

    def _update_throttle_locked(self) -> float:
        """Throttle = min factor ever required by current drawdown (ratchet down)."""
        st = self.state
        dd = 0.0
        if st.peak_equity > 0:
            dd = max(0.0, (st.peak_equity - st.equity) / st.peak_equity)
        factor = 1.0
        for threshold, mult in DRAWDOWN_TIERS:
            if dd < threshold:
                factor = mult
                break
        # Ratchet: never let the throttle increase back after losses.
        st.throttle = min(st.throttle, factor)
        return st.throttle

    # -- public API ------------------------------------------------------
    def can_trade(self) -> bool:
        with self._lock:
            self._roll_day_if_needed_locked()
            return not self.state.halted

    def status(self) -> RiskState:
        with self._lock:
            self._roll_day_if_needed_locked()
            self._update_throttle_locked()
            return self.state

    def position_size(
        self, entry_price: float, stop_distance: float
    ) -> float:
        """Base-asset size so that a stop-out loses risk_per_trade * throttle
        of current equity. Returns 0.0 when trading is halted or inputs invalid.

        stop_distance is the per-unit loss from entry to the stop (absolute
        price distance, > 0).
        """
        if entry_price <= 0 or stop_distance <= 0:
            return 0.0
        with self._lock:
            self._roll_day_if_needed_locked()
            if self.state.halted:
                return 0.0
            throttle = self._update_throttle_locked()
            risk_amount = self.state.equity * self.risk_per_trade * throttle
            size = risk_amount / stop_distance
            return max(0.0, size)

    def on_trade_closed(self, pnl: float) -> Dict:
        """Report realized PnL (quote currency, negative = loss).

        Updates equity, daily PnL, drawdown throttle, and trips the daily
        loss cap halt. Returns a decision dict for the journal.
        """
        with self._lock:
            self._roll_day_if_needed_locked()
            st = self.state
            st.equity += pnl
            st.daily_pnl += pnl
            st.trades_today += 1
            st.peak_equity = max(st.peak_equity, st.equity)
            throttle = self._update_throttle_locked()

            decision: Dict[str, object] = {
                "pnl": round(pnl, 8),
                "equity": round(st.equity, 8),
                "daily_pnl": round(st.daily_pnl, 8),
                "throttle": throttle,
                "halted": st.halted,
            }

            cap_amount = st.day_start_equity * self.daily_loss_cap
            if st.daily_pnl <= -cap_amount:
                st.halted = True
                decision["halted"] = True
                decision["halt_reason"] = (
                    f"daily loss cap hit: {st.daily_pnl:.2f} <= -{cap_amount:.2f} "
                    f"({self.mode.value} mode)"
                )
            return decision

    def drawdown(self) -> float:
        with self._lock:
            st = self.state
            if st.peak_equity <= 0:
                return 0.0
            return max(0.0, (st.peak_equity - st.equity) / st.peak_equity)
