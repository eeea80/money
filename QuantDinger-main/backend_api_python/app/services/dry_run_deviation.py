"""Live trading vs backtest deviation report.

For every recorded live trade we look up the K-line bar that contained the
trade's ``created_at`` timestamp and the *previous closed bar* — that prior
close is what a vanilla backtest would have used as a signal price. Comparing
that reference price against the actual fill price gives us a per-trade
slippage in basis points (signed by direction).

The aggregate report exposes:

* per-trade rows enriched with ``signalPrice`` / ``slippageBps`` / ``latencyMs``
* summary stats (count, mean / median / p90 slippage, total cost in $)
* a "verdict" qualitative label so the user can tell at a glance whether the
  strategy is behaving as the backtest implied.

No new database schema is required — everything is derived on demand.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.services.kline import KlineService
from app.utils.db import get_db_connection
from app.utils.logger import get_logger

logger = get_logger(__name__)


# Map a UI timeframe string to seconds. Keep loose mapping (matches the rest
# of the project) so we don't fail on uncommon variants.
_TIMEFRAME_SECONDS = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800,
    '12h': 43200, '1d': 86400, '1D': 86400, '3d': 259200,
    '1w': 604800, '1W': 604800, '1M': 2592000,
}


def _timeframe_to_seconds(timeframe: str) -> int:
    return _TIMEFRAME_SECONDS.get(str(timeframe or '1m').strip(), 60)


def _trade_direction_factor(trade_type: str) -> int:
    """Sign for slippage normalisation.

    Positive when paying a *worse* price than the signal close (i.e. the
    user lost edge). For an open-long fill above the signal close we lost
    edge, so the slippage is positive. For close-long below the signal close
    we also lost edge, so positive. Symmetric for shorts.
    """
    t = (trade_type or '').strip().lower()
    if t in ('open_long', 'add_long', 'close_short', 'reduce_short'):
        return 1
    if t in ('open_short', 'add_short', 'close_long', 'reduce_long'):
        return -1
    return 1


@dataclass
class TradeDeviation:
    trade_id: int
    created_at_unix: int
    symbol: str
    trade_type: str
    fill_price: float
    fill_amount: float
    signal_price: Optional[float]
    signal_bar_close_unix: Optional[int]
    slippage_bps: Optional[float]
    slippage_cost: Optional[float]
    latency_seconds: Optional[float]

    def to_dict(self) -> Dict[str, Any]:
        return {
            'tradeId': self.trade_id,
            'createdAt': self.created_at_unix,
            'symbol': self.symbol,
            'type': self.trade_type,
            'fillPrice': self.fill_price,
            'fillAmount': self.fill_amount,
            'signalPrice': self.signal_price,
            'signalBarClose': self.signal_bar_close_unix,
            'slippageBps': self.slippage_bps,
            'slippageCost': self.slippage_cost,
            'latencySeconds': self.latency_seconds,
        }


class DryRunDeviationService:
    """Compare live fills to their notional backtest reference prices."""

    def __init__(self, kline_service: Optional[KlineService] = None) -> None:
        self.kline_service = kline_service or KlineService()

    def build_report(
        self,
        *,
        strategy_id: int,
        user_id: int,
        limit: int = 200,
    ) -> Dict[str, Any]:
        """Return the deviation report for ``strategy_id``.

        ``user_id`` is required only to ensure the caller actually owns the
        strategy — we still re-fetch the strategy row here so callers don't
        need to pre-load it.
        """
        strategy = self._fetch_strategy(strategy_id, user_id)
        if not strategy:
            return self._empty_report(reason='strategy_not_found')

        symbol = str(strategy.get('symbol') or '').strip()
        timeframe = str(strategy.get('timeframe') or '').strip()
        market = str(strategy.get('market_category') or 'Crypto').strip() or 'Crypto'
        if not symbol or not timeframe:
            return self._empty_report(reason='missing_symbol_or_timeframe')

        trades = self._fetch_trades(strategy_id, limit=limit)
        if not trades:
            return self._empty_report(symbol=symbol, timeframe=timeframe)

        tf_seconds = _timeframe_to_seconds(timeframe)
        # Fetch a single K-line window spanning the trade range so we only
        # hit the data source once (the worker DB may not have minute-level
        # bars locally, so we lean on the live source via KlineService).
        first_ts = min(t['created_at_unix'] for t in trades)
        last_ts = max(t['created_at_unix'] for t in trades)
        bars = self._fetch_klines_covering(
            market=market,
            symbol=symbol,
            timeframe=timeframe,
            tf_seconds=tf_seconds,
            from_unix=first_ts - tf_seconds,
            to_unix=last_ts + tf_seconds,
        )
        bar_index = self._index_bars_by_close(bars, tf_seconds)

        deviations: List[TradeDeviation] = []
        for trade in trades:
            dev = self._compute_trade_deviation(
                trade=trade,
                tf_seconds=tf_seconds,
                bar_index=bar_index,
            )
            deviations.append(dev)

        summary = self._summarise(deviations)
        return {
            'strategyId': strategy_id,
            'symbol': symbol,
            'timeframe': timeframe,
            'tfSeconds': int(tf_seconds),
            'market': market,
            'trades': [dev.to_dict() for dev in deviations],
            'summary': summary,
            'verdict': self._verdict_for(summary, tf_seconds),
            'sampleSize': len(deviations),
        }

    # ------------------------------------------------------------------
    # data fetching
    # ------------------------------------------------------------------

    @staticmethod
    def _fetch_strategy(strategy_id: int, user_id: int) -> Optional[Dict[str, Any]]:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT id, user_id, symbol, timeframe, market_category, strategy_name
                FROM qd_strategies_trading
                WHERE id = %s AND user_id = %s
                """,
                (int(strategy_id), int(user_id)),
            )
            row = cur.fetchone()
            cur.close()
        return dict(row) if row else None

    @staticmethod
    def _fetch_trades(strategy_id: int, limit: int = 200) -> List[Dict[str, Any]]:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT id, strategy_id, symbol, type, price, amount, created_at
                FROM qd_strategy_trades
                WHERE strategy_id = %s
                ORDER BY id DESC
                LIMIT %s
                """,
                (int(strategy_id), int(limit)),
            )
            rows = cur.fetchall() or []
            cur.close()
        out: List[Dict[str, Any]] = []
        for row in rows:
            trade = dict(row)
            created_at = trade.get('created_at')
            if not created_at:
                continue
            if hasattr(created_at, 'timestamp'):
                # Naive datetimes from PostgreSQL session UTC are interpreted
                # as UTC instants — matching how /strategies/trades sends them.
                dt = created_at
                if getattr(dt, 'tzinfo', None) is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                trade['created_at_unix'] = int(dt.timestamp())
            elif isinstance(created_at, str):
                try:
                    dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                    if getattr(dt, 'tzinfo', None) is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    trade['created_at_unix'] = int(dt.timestamp())
                except Exception:
                    continue
            else:
                continue
            try:
                trade['price'] = float(trade.get('price') or 0.0)
                trade['amount'] = float(trade.get('amount') or 0.0)
            except (TypeError, ValueError):
                continue
            if trade['price'] <= 0 or trade['amount'] <= 0:
                continue
            out.append(trade)
        return out

    def _fetch_klines_covering(
        self,
        *,
        market: str,
        symbol: str,
        timeframe: str,
        tf_seconds: int,
        from_unix: int,
        to_unix: int,
    ) -> List[Dict[str, Any]]:
        """Pull enough K-line history to cover the trade range.

        We over-fetch by one bar on either side so the *signal* bar (the one
        whose close was the decision price) is always in the index.
        """
        span = max(0, to_unix - from_unix)
        bars_needed = max(50, int(span / max(tf_seconds, 1)) + 10)
        bars_needed = min(bars_needed, 1500)  # data sources cap aggressively

        try:
            return self.kline_service.get_kline(
                market=market,
                symbol=symbol,
                timeframe=timeframe,
                limit=bars_needed,
                before_time=int(to_unix) + tf_seconds,
            ) or []
        except Exception as exc:
            logger.warning("kline fetch failed for %s:%s %s: %s", market, symbol, timeframe, exc)
            return []

    # ------------------------------------------------------------------
    # per-trade computation
    # ------------------------------------------------------------------

    @staticmethod
    def _index_bars_by_close(
        bars: List[Dict[str, Any]],
        tf_seconds: int,
    ) -> List[Tuple[int, Dict[str, Any]]]:
        """Sort bars by close time so we can binary-search by trade timestamp."""
        idx: List[Tuple[int, Dict[str, Any]]] = []
        for bar in bars or []:
            open_ts = bar.get('time') or bar.get('timestamp') or bar.get('t')
            if open_ts is None:
                continue
            try:
                open_ts = int(open_ts)
            except (TypeError, ValueError):
                continue
            # Some sources return ms; normalise to seconds heuristically.
            if open_ts > 10**12:
                open_ts //= 1000
            close_ts = open_ts + tf_seconds
            idx.append((close_ts, bar))
        idx.sort(key=lambda item: item[0])
        return idx

    def _compute_trade_deviation(
        self,
        *,
        trade: Dict[str, Any],
        tf_seconds: int,
        bar_index: List[Tuple[int, Dict[str, Any]]],
    ) -> TradeDeviation:
        created_at = int(trade['created_at_unix'])
        fill_price = float(trade.get('price') or 0.0)
        fill_amount = float(trade.get('amount') or 0.0)
        trade_type = str(trade.get('type') or '')

        signal_close, signal_bar_close = self._signal_close_for(
            created_at=created_at,
            tf_seconds=tf_seconds,
            bar_index=bar_index,
        )

        slippage_bps: Optional[float] = None
        slippage_cost: Optional[float] = None
        latency_seconds: Optional[float] = None
        if signal_close and signal_close > 0:
            direction = _trade_direction_factor(trade_type)
            slippage_bps = round(
                ((fill_price - signal_close) / signal_close) * direction * 10000.0,
                2,
            )
            slippage_cost = round(
                (fill_price - signal_close) * direction * fill_amount,
                4,
            )
            latency_seconds = float(created_at - signal_bar_close) if signal_bar_close else None

        return TradeDeviation(
            trade_id=int(trade.get('id') or 0),
            created_at_unix=created_at,
            symbol=str(trade.get('symbol') or ''),
            trade_type=trade_type,
            fill_price=fill_price,
            fill_amount=fill_amount,
            signal_price=signal_close,
            signal_bar_close_unix=signal_bar_close,
            slippage_bps=slippage_bps,
            slippage_cost=slippage_cost,
            latency_seconds=latency_seconds,
        )

    @staticmethod
    def _signal_close_for(
        *,
        created_at: int,
        tf_seconds: int,
        bar_index: List[Tuple[int, Dict[str, Any]]],
    ) -> Tuple[Optional[float], Optional[int]]:
        """Return ``(signal_close_price, signal_bar_close_ts)``.

        The signal bar is the most recent bar whose ``close_ts <= created_at``.
        A backtest executing at the next bar's open would have used *that*
        bar's close as its decision price.
        """
        if not bar_index:
            return None, None
        # Binary search for the rightmost bar with close_ts <= created_at.
        lo, hi = 0, len(bar_index) - 1
        found = -1
        while lo <= hi:
            mid = (lo + hi) // 2
            if bar_index[mid][0] <= created_at:
                found = mid
                lo = mid + 1
            else:
                hi = mid - 1
        if found < 0:
            return None, None
        close_ts, bar = bar_index[found]
        try:
            close_px = float(bar.get('close') or 0.0)
        except (TypeError, ValueError):
            return None, None
        if close_px <= 0:
            return None, None
        return close_px, int(close_ts)

    # ------------------------------------------------------------------
    # aggregation
    # ------------------------------------------------------------------

    def _summarise(self, deviations: List[TradeDeviation]) -> Dict[str, Any]:
        slips = [d.slippage_bps for d in deviations if d.slippage_bps is not None]
        costs = [d.slippage_cost for d in deviations if d.slippage_cost is not None]
        latencies = [d.latency_seconds for d in deviations if d.latency_seconds is not None]

        def _pct(values: List[float], p: float) -> Optional[float]:
            if not values:
                return None
            sorted_vals = sorted(values)
            k = int(round((len(sorted_vals) - 1) * p))
            return round(sorted_vals[k], 2)

        return {
            'sampleSize': len(deviations),
            'matchedTrades': len(slips),
            'avgSlippageBps': round(sum(slips) / len(slips), 2) if slips else None,
            'medianSlippageBps': _pct(slips, 0.5),
            'p90SlippageBps': _pct(slips, 0.9),
            'maxAdverseSlippageBps': round(max(slips), 2) if slips else None,
            'totalSlippageCost': round(sum(costs), 4) if costs else None,
            'avgLatencySeconds': round(sum(latencies) / len(latencies), 1) if latencies else None,
            'maxLatencySeconds': round(max(latencies), 1) if latencies else None,
        }

    @staticmethod
    def _verdict_thresholds_for(tf_seconds: int) -> Dict[str, float]:
        """Verdict thresholds (in bps) scaled by timeframe.

        The report defines slippage as ``(fill_price - previous_bar_close)``.
        For 1m / 5m bars the previous close is essentially a tick away from
        the fill, so 5-15 bps is genuinely "good execution". For 1h / 4h
        bars the same metric also captures the *intra-bar drift* between the
        last close and whenever the strategy actually fired the order — that
        drift dominates the number and has nothing to do with execution
        quality. Without widening the bands here every long-TF strategy
        would be labelled ``bad`` regardless of how clean the broker fills
        are.

        Numbers are anchored to empirically reasonable ETH/BTC ranges:
          - 1m-30m bars: drift ~< 5 bps, fills usually within 10 bps
          - 1h-2h bars:  drift ~10-20 bps, fills within 30-50 bps is normal
          - 4h-12h bars: drift ~30-50 bps in liquid alts, 100+ on news days
          - 1d+ bars:    drift can hit 0.5-1% (50-100 bps) on any move
        """
        if tf_seconds <= 0:
            tf_seconds = 60
        if tf_seconds < 3600:        # < 1h
            return {'good_avg': 5.0,  'good_p90': 15.0,  'warn_avg': 20.0,  'warn_p90': 50.0}
        if tf_seconds < 14400:       # 1h, 2h
            return {'good_avg': 15.0, 'good_p90': 40.0,  'warn_avg': 50.0,  'warn_p90': 120.0}
        if tf_seconds < 86400:       # 4h, 6h, 8h, 12h
            return {'good_avg': 30.0, 'good_p90': 80.0,  'warn_avg': 100.0, 'warn_p90': 250.0}
        return {'good_avg': 60.0,    'good_p90': 150.0, 'warn_avg': 200.0, 'warn_p90': 500.0}  # 1d+

    @staticmethod
    def _verdict_for(summary: Dict[str, Any], tf_seconds: int) -> Dict[str, Any]:
        thresholds = DryRunDeviationService._verdict_thresholds_for(tf_seconds)
        avg = summary.get('avgSlippageBps')
        p90 = summary.get('p90SlippageBps')
        matched = int(summary.get('matchedTrades') or 0)
        if matched < 5 or avg is None:
            return {
                'level': 'unknown',
                'reason': 'insufficient_sample',
                'thresholds': thresholds,
                'tfSeconds': int(tf_seconds),
            }
        if avg <= thresholds['good_avg'] and (p90 or 0) <= thresholds['good_p90']:
            return {
                'level': 'good',
                'reason': 'within_expected_drift',
                'thresholds': thresholds,
                'tfSeconds': int(tf_seconds),
            }
        if avg <= thresholds['warn_avg'] and (p90 or 0) <= thresholds['warn_p90']:
            return {
                'level': 'warn',
                'reason': 'slippage_elevated',
                'thresholds': thresholds,
                'tfSeconds': int(tf_seconds),
            }
        return {
            'level': 'bad',
            'reason': 'slippage_excessive',
            'thresholds': thresholds,
            'tfSeconds': int(tf_seconds),
        }

    # ------------------------------------------------------------------
    # boilerplate
    # ------------------------------------------------------------------

    def _empty_report(
        self,
        *,
        symbol: str = '',
        timeframe: str = '',
        reason: str = 'no_trades',
    ) -> Dict[str, Any]:
        tf_seconds = _timeframe_to_seconds(timeframe) if timeframe else 60
        thresholds = self._verdict_thresholds_for(tf_seconds)
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'tfSeconds': int(tf_seconds),
            'trades': [],
            'summary': self._summarise([]),
            'verdict': {
                'level': 'unknown',
                'reason': reason,
                'thresholds': thresholds,
                'tfSeconds': int(tf_seconds),
            },
            'sampleSize': 0,
        }
