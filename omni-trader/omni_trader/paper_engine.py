"""Paper-trading engine — simulates fills WITHOUT touching any exchange.

Execution model (no look-ahead bias):
- Strategies evaluate on CLOSED candles only.
- Orders become "pending" at candle-close time + execution latency
  (default 140 ms, configurable) and FILL at the NEXT candle's open price
  (adverse slippage applied, configurable).
- Stop-losses are checked intrabar on every new candle.
- Fees: 0.1% taker per side by default.

No real orders anywhere: there is no order-placement code path at all.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import pandas as pd

from .journal import Journal
from .risk import RiskManager
from .strategies import Signal, Strategy

logger = logging.getLogger(__name__)


@dataclass
class PaperConfig:
    starting_equity: float = 10_000.0
    fee_rate: float = 0.001          # 0.1% per side (Binance taker baseline)
    slippage_pct: float = 0.0005     # 0.05% adverse fill
    execution_latency_ms: float = 140.0
    stop_loss_pct: float = 0.01      # per-position stop distance from entry
    default_risk_mode: str = "balanced"


@dataclass
class Position:
    side: str                        # long | short
    qty: float
    entry_price: float
    entry_time: pd.Timestamp
    stop_price: float
    signal_in: str
    trade_id: int


@dataclass
class PendingOrder:
    action: str                      # open_long | open_short | close
    submit_time: pd.Timestamp
    signal: str
    reasons: List[str] = field(default_factory=list)
    signal_ts: pd.Timestamp | None = None


class PaperEngine:
    """Candle-driven paper trading loop component."""

    def __init__(
        self,
        strategy: Strategy,
        journal: Journal,
        risk_manager: Optional[RiskManager] = None,
        config: Optional[PaperConfig] = None,
        symbol: str = "BTC/USDT",
        timeframe: str = "1m",
    ) -> None:
        self.strategy = strategy
        self.journal = journal
        self.risk = risk_manager or RiskManager(
            starting_equity=(config or PaperConfig()).starting_equity,
            mode=(config or PaperConfig()).default_risk_mode,
        )
        self.config = config or PaperConfig()
        self.symbol = symbol
        self.timeframe = timeframe
        self.position: Optional[Position] = None
        self.pending: Optional[PendingOrder] = None
        self.last_close_ts: Optional[pd.Timestamp] = None
        self.fills: int = 0

    # ------------------------------------------------------------------
    def on_candle(self, df: pd.DataFrame, data_source: str = "unknown") -> None:
        """Feed the latest closed-candle frame; processes every new candle in order."""
        if df.empty:
            return
        for i in range(len(df)):
            ts = df.index[i]
            if self.last_close_ts is not None and ts <= self.last_close_ts:
                continue
            candle = df.iloc[: i + 1]
            self._process_candle(candle, data_source)
            self.last_close_ts = ts

    # ------------------------------------------------------------------
    def _process_candle(self, candle: pd.DataFrame, data_source: str) -> None:
        row = candle.iloc[-1]
        open_ts = candle.index[-1]
        open_price = float(row["open"])

        # 1) Fill any pending order at THIS candle's open (order submitted
        #    at previous close + latency, so next open is the first price
        #    the market can show us).
        if self.pending is not None:
            self._try_fill(open_ts, open_price, data_source)

        # 2) Intrabar stop check on this candle's high/low.
        if self.position is not None:
            self._check_stop(row)

        # 3) Evaluate the strategy on the closed candle.
        sig = self.strategy.generate(candle)
        acted = self._act_on_signal(sig, open_ts, data_source)
        self.journal.record_signal(
            strategy=sig.strategy,
            symbol=self.symbol,
            timeframe=self.timeframe,
            signal=sig.signal.value,
            price=sig.price,
            reasons=sig.reasons,
            equity_at_signal=self.risk.status().equity,
            acted=acted,
            data_source=data_source,
        )
        if sig.signal != Signal.FLAT or acted:
            logger.info(
                "SIGNAL %s %s @ %.2f acted=%s reasons=%s",
                sig.strategy, sig.signal.value, sig.price, acted, sig.reasons,
            )

    # ------------------------------------------------------------------
    def _act_on_signal(self, sig, open_ts: pd.Timestamp, data_source: str) -> bool:
        """Queue orders as pending; fills happen at the next candle open."""
        submit_ts = sig.timestamp + pd.Timedelta(
            milliseconds=self.config.execution_latency_ms
        )
        acted = False
        want = sig.signal

        if self.position is None:
            if want in (Signal.LONG, Signal.SHORT) and self.risk.can_trade():
                self.pending = PendingOrder(
                    action="open_long" if want == Signal.LONG else "open_short",
                    submit_time=submit_ts,
                    signal=want.value,
                    reasons=list(sig.reasons),
                    signal_ts=sig.timestamp,
                )
                acted = True
        else:
            opposite = (
                (self.position.side == "long" and want == Signal.SHORT)
                or (self.position.side == "short" and want == Signal.LONG)
            )
            if want == Signal.FLAT or opposite:
                self.pending = PendingOrder(
                    action="close",
                    submit_time=submit_ts,
                    signal=want.value,
                    reasons=list(sig.reasons),
                    signal_ts=sig.timestamp,
                )
                acted = True
            elif opposite is False and (
                (self.position.side == "long" and want == Signal.LONG)
                or (self.position.side == "short" and want == Signal.SHORT)
            ):
                # Already in the direction — hold; not an action.
                acted = False
        return acted

    # ------------------------------------------------------------------
    def _try_fill(self, open_ts: pd.Timestamp, open_price: float, data_source: str) -> None:
        order, self.pending = self.pending, None
        if order is None:
            return
        # Latency accounting: fill time is the later of candle open and
        # submit time (with 140ms latency and >=1m candles this is the open).
        fill_time = max(open_ts, order.submit_time)
        slip = self.config.slippage_pct

        if order.action == "close" and self.position is not None:
            pos = self.position
            if pos.side == "long":
                exit_price = open_price * (1 - slip)
                pnl = (exit_price - pos.entry_price) * pos.qty
            else:
                exit_price = open_price * (1 + slip)
                pnl = (pos.entry_price - exit_price) * pos.qty
            fees = (pos.entry_price * pos.qty + exit_price * pos.qty) * self.config.fee_rate
            pnl -= fees
            self._close_position(pos, exit_price, fill_time, pnl, fees, order, data_source)
            return

        if order.action in ("open_long", "open_short") and self.position is None:
            side = "long" if order.action == "open_long" else "short"
            stop_distance = open_price * self.config.stop_loss_pct
            qty = self.risk.position_size(open_price, stop_distance)
            if qty <= 0:
                self.journal.record_decision(
                    "skip",
                    {"reason": "risk manager refused size", "at": str(fill_time)},
                )
                return
            if side == "long":
                entry_price = open_price * (1 + slip)
                stop_price = entry_price * (1 - self.config.stop_loss_pct)
            else:
                entry_price = open_price * (1 - slip)
                stop_price = entry_price * (1 + self.config.stop_loss_pct)
            entry_fee = entry_price * qty * self.config.fee_rate
            latency_ms = (
                fill_time - order.signal_ts
            ).total_seconds() * 1000.0 if order.signal_ts else self.config.execution_latency_ms
            trade_id = self.journal.record_trade_open(
                strategy=self.strategy.name,
                symbol=self.symbol,
                timeframe=self.timeframe,
                side=side,
                qty=qty,
                entry_price=entry_price,
                entry_time=str(fill_time),
                signal_in=order.signal,
                latency_ms=latency_ms,
            )
            self.journal.record_decision(
                "fill",
                {
                    "action": order.action,
                    "qty": qty,
                    "price": entry_price,
                    "fill_time": str(fill_time),
                    "latency_ms": latency_ms,
                    "data_source": data_source,
                },
            )
            self.position = Position(
                side=side,
                qty=qty,
                entry_price=entry_price,
                entry_time=fill_time,
                stop_price=stop_price,
                signal_in=order.signal,
                trade_id=trade_id,
            )
            self.fills += 1
            logger.info(
                "FILL %s %s qty=%.6f @ %.2f (entry fee %.4f)",
                side.upper(), self.symbol, qty, entry_price, entry_fee,
            )

    # ------------------------------------------------------------------
    def _check_stop(self, row: pd.Series) -> None:
        pos = self.position
        if pos is None:
            return
        hit = (
            pos.side == "long" and float(row["low"]) <= pos.stop_price
        ) or (
            pos.side == "short" and float(row["high"]) >= pos.stop_price
        )
        if not hit:
            return
        slip = self.config.slippage_pct
        if pos.side == "long":
            exit_price = pos.stop_price * (1 - slip)
            pnl = (exit_price - pos.entry_price) * pos.qty
        else:
            exit_price = pos.stop_price * (1 + slip)
            pnl = (pos.entry_price - exit_price) * pos.qty
        fees = (pos.entry_price * pos.qty + exit_price * pos.qty) * self.config.fee_rate
        pnl -= fees
        order = PendingOrder(
            action="close", submit_time=row.name, signal="stop_loss",
            reasons=["stop-loss hit"],
        )
        self._close_position(pos, exit_price, row.name, pnl, fees, order, "unknown")

    # ------------------------------------------------------------------
    def _close_position(
        self, pos: Position, exit_price: float, exit_time: pd.Timestamp,
        pnl: float, fees: float, order: PendingOrder, data_source: str,
    ) -> None:
        entry_notional = pos.entry_price * pos.qty
        pnl_pct = (pnl / entry_notional) * 100.0 if entry_notional > 0 else 0.0
        self.journal.record_trade_close(
            trade_id=pos.trade_id,
            exit_price=exit_price,
            exit_time=str(exit_time),
            pnl=pnl,
            pnl_pct=pnl_pct,
            fees=fees,
            signal_out=order.signal,
        )
        decision = self.risk.on_trade_closed(pnl)
        st = self.risk.status()
        self.journal.record_outcome(
            trade_id=pos.trade_id,
            equity=st.equity,
            drawdown_pct=self.risk.drawdown() * 100.0,
            daily_pnl=st.daily_pnl,
        )
        self.journal.update_memory(
            self.strategy.name, self.symbol, self.timeframe,
            pnl=pnl, is_win=(pnl > 0),
        )
        if decision.get("halted"):
            self.journal.record_decision("halt", decision)
            logger.warning("RISK: %s", decision.get("halt_reason", "halted"))
        logger.info(
            "CLOSE %s @ %.2f pnl=%.2f (%.3f%%) equity=%.2f throttle=%.2f",
            pos.side, exit_price, pnl, pnl_pct, st.equity, st.throttle,
        )
        self.position = None

    # ------------------------------------------------------------------
    def status(self) -> Dict:
        st = self.risk.status()
        return {
            "symbol": self.symbol,
            "timeframe": self.timeframe,
            "strategy": self.strategy.name,
            "equity": round(st.equity, 2),
            "daily_pnl": round(st.daily_pnl, 2),
            "risk_mode": self.risk.mode.value,
            "risk_per_trade_pct": self.risk.risk_per_trade * 100.0,
            "halted": st.halted,
            "throttle": st.throttle,
            "drawdown_pct": round(self.risk.drawdown() * 100.0, 3),
            "position": (
                {
                    "side": self.position.side,
                    "qty": self.position.qty,
                    "entry_price": self.position.entry_price,
                    "stop_price": self.position.stop_price,
                }
                if self.position else None
            ),
            "pending": (
                {"action": self.pending.action, "submit_time": str(self.pending.submit_time)}
                if self.pending else None
            ),
            "fills": self.fills,
            "execution_latency_ms": self.config.execution_latency_ms,
        }
