"""Unified order intent service used by strategy runtime and pending orders."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

from app.utils.db import get_db_connection
from app.utils.logger import get_logger

from .events import append_runtime_event
from .signals import StrategySignal

logger = get_logger(__name__)


@dataclass(frozen=True)
class OrderIntent:
    id: int
    idempotency_key: str
    status: str
    existing: bool = False


class OrderIntentService:
    def __init__(self, *, strategy_id: int, strategy_run_id: int = 0):
        self.strategy_id = int(strategy_id or 0)
        self.strategy_run_id = int(strategy_run_id or 0)

    @staticmethod
    def build_signal_idempotency_key(
        *,
        strategy_run_id: int,
        strategy_id: int,
        symbol: str,
        signal_type: str,
        signal_ts: int,
    ) -> str:
        return (
            f"run:{int(strategy_run_id or 0)}:"
            f"strategy:{int(strategy_id or 0)}:{symbol}:{signal_type}:{int(signal_ts or 0)}"
        )[:180]

    def get_by_key(self, idempotency_key: str) -> Optional[OrderIntent]:
        try:
            with get_db_connection() as db:
                cur = db.cursor()
                cur.execute(
                    """
                    SELECT id, idempotency_key, status
                    FROM strategy_order_intents
                    WHERE strategy_run_id = %s AND idempotency_key = %s
                    LIMIT 1
                    """,
                    (self.strategy_run_id, str(idempotency_key or "")),
                )
                row = cur.fetchone() or {}
                cur.close()
            if row:
                return OrderIntent(
                    id=int(row.get("id") or 0),
                    idempotency_key=str(row.get("idempotency_key") or idempotency_key),
                    status=str(row.get("status") or ""),
                    existing=True,
                )
        except Exception as exc:
            logger.debug("order intent lookup skipped: %s", exc)
        return None

    def create_intent(
        self,
        *,
        idempotency_key: str,
        symbol: str,
        side: str,
        market_type: str = "swap",
        position_side: str = "",
        reduce_only: bool = False,
        order_type: str = "market",
        quantity: float = 0.0,
        notional: float = 0.0,
        limit_price: float = 0.0,
        execution_algo: str = "market",
        portfolio_id: str = "",
        universe_id: str = "",
        rebalance_group_id: str = "",
        target_weight: Optional[float] = None,
        target_notional: Optional[float] = None,
        target_position_qty: Optional[float] = None,
        client_order_id: str = "",
        payload: Dict[str, Any] | None = None,
    ) -> OrderIntent:
        key = str(idempotency_key or "").strip()[:180]
        if not key:
            raise ValueError("idempotency_key is required")
        existing = self.get_by_key(key)
        if existing is not None and existing.id > 0:
            return existing
        try:
            safe_payload = json.loads(json.dumps(payload or {}, default=str))
        except Exception:
            safe_payload = {}
        try:
            with get_db_connection() as db:
                cur = db.cursor()
                cur.execute(
                    """
                    INSERT INTO strategy_order_intents
                    (strategy_run_id, strategy_id, idempotency_key,
                     symbol, market_type, side, position_side, reduce_only, order_type,
                     quantity, notional, limit_price, execution_algo,
                     portfolio_id, universe_id, rebalance_group_id,
                     target_weight, target_notional, target_position_qty,
                     status, client_order_id, payload_json,
                     created_at, updated_at)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                     %s, %s, %s, %s, %s, %s,
                     'intent_created', %s, %s, NOW(), NOW())
                    ON CONFLICT(strategy_run_id, idempotency_key) DO NOTHING
                    """,
                    (
                        self.strategy_run_id,
                        self.strategy_id,
                        key,
                        str(symbol or ""),
                        str(market_type or "swap"),
                        str(side or ""),
                        str(position_side or ""),
                        bool(reduce_only),
                        str(order_type or "market"),
                        float(quantity or 0.0),
                        float(notional or 0.0),
                        float(limit_price or 0.0),
                        str(execution_algo or "market"),
                        str(portfolio_id or ""),
                        str(universe_id or ""),
                        str(rebalance_group_id or ""),
                        target_weight,
                        target_notional,
                        target_position_qty,
                        str(client_order_id or "")[:100],
                        json.dumps(safe_payload, ensure_ascii=False),
                    ),
                )
                intent_id = int(cur.lastrowid or 0)
                if intent_id <= 0:
                    # ON CONFLICT DO NOTHING with auto RETURNING can leave no id.
                    cur.execute(
                        """
                        SELECT id, status
                        FROM strategy_order_intents
                        WHERE strategy_run_id = %s AND idempotency_key = %s
                        LIMIT 1
                        """,
                        (self.strategy_run_id, key),
                    )
                    row = cur.fetchone() or {}
                    intent_id = int(row.get("id") or 0)
                    status = str(row.get("status") or "intent_created")
                    db.commit()
                    cur.close()
                    return OrderIntent(intent_id, key, status, existing=True)
                db.commit()
                cur.close()
            append_runtime_event(
                strategy_id=self.strategy_id,
                strategy_run_id=self.strategy_run_id,
                event_type="order_intent_created",
                message=f"Order intent created: {side} {symbol}",
                payload={"idempotency_key": key, "intent_id": intent_id},
            )
            return OrderIntent(intent_id, key, "intent_created", existing=False)
        except Exception as exc:
            logger.warning("order intent create failed: %s", exc)
            return OrderIntent(0, key, "ephemeral", existing=False)

    def statuses_by_client_order_ids(
        self,
        references: list[str] | set[str] | tuple[str, ...],
    ) -> Dict[str, Dict[str, Any]]:
        refs = [str(item or "").strip()[:100] for item in references if str(item or "").strip()]
        if not refs:
            return {}
        try:
            with get_db_connection() as db:
                cur = db.cursor()
                cur.execute(
                    """
                    SELECT
                        soi.client_order_id,
                        soi.status,
                        COALESCE(SUM(sof.quantity), 0) AS filled_quantity,
                        COALESCE(SUM(sof.notional), 0) AS filled_notional,
                        COALESCE(SUM(sof.fee), 0) AS fee
                    FROM strategy_order_intents soi
                    LEFT JOIN strategy_order_fills sof
                      ON sof.order_intent_id = soi.id
                    WHERE soi.strategy_run_id = %s
                      AND soi.client_order_id = ANY(%s)
                    GROUP BY soi.id, soi.client_order_id, soi.status
                    """,
                    (self.strategy_run_id, refs),
                )
                rows = cur.fetchall() or []
                cur.close()
        except Exception as exc:
            logger.debug("order intent status lookup skipped: %s", exc)
            return {}
        return {
            str(row.get("client_order_id") or ""): {
                "client_order_id": str(row.get("client_order_id") or ""),
                "status": str(row.get("status") or "unknown"),
                "filled_quantity": float(row.get("filled_quantity") or 0.0),
                "filled_notional": float(row.get("filled_notional") or 0.0),
                "fee": float(row.get("fee") or 0.0),
            }
            for row in rows
            if str(row.get("client_order_id") or "")
        }

    def create_from_signal(
        self,
        signal: StrategySignal,
        *,
        idempotency_key: str = "",
        leverage: float = 1.0,
    ) -> OrderIntent:
        signal.validate()
        key = str(idempotency_key or "").strip()
        if not key:
            key = self.build_signal_idempotency_key(
                strategy_run_id=signal.strategy_run_id or self.strategy_run_id,
                strategy_id=signal.strategy_id or self.strategy_id,
                symbol=signal.symbol,
                signal_type=signal.action,
                signal_ts=_signal_ts(signal.timestamp),
            )
        kwargs = signal.to_order_intent_kwargs(leverage=leverage)
        return self.create_intent(
            idempotency_key=key,
            portfolio_id=signal.portfolio_id,
            universe_id=signal.universe_id,
            rebalance_group_id=signal.rebalance_group_id,
            target_weight=signal.target_weight,
            target_notional=signal.target_notional,
            target_position_qty=signal.target_position_qty,
            **kwargs,
        )


def _signal_ts(value: Any) -> int:
    try:
        if hasattr(value, "timestamp"):
            return int(value.timestamp())
        return int(value or 0)
    except Exception:
        return 0
