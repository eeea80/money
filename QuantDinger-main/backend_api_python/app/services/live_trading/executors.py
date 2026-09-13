"""Execution algorithms built on normalized live-trading adapter contracts."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any, Dict, Optional

from app.services.live_trading.base import LiveOrderResult, LiveTradingError
from app.services.live_trading.contracts import ExchangeOrderAdapter, FillSnapshot, OrderIntent
from app.services.pending_orders.sent_order_recovery import normalize_live_order_status


@dataclass(frozen=True)
class OrderExecutionResult:
    success: bool
    exchange_id: str = ""
    exchange_order_id: str = ""
    filled_qty: float = 0.0
    avg_price: float = 0.0
    status: str = ""
    error: str = ""
    raw: Dict[str, Any] = field(default_factory=dict)
    fees_by_ccy: Dict[str, float] = field(default_factory=dict)

    @classmethod
    def from_live_order(cls, result: LiveOrderResult, *, status: str = "submitted") -> "OrderExecutionResult":
        return cls(
            success=True,
            exchange_id=str(result.exchange_id or ""),
            exchange_order_id=str(result.exchange_order_id or ""),
            filled_qty=float(result.filled or 0.0),
            avg_price=float(result.avg_price or 0.0),
            status=status,
            raw=dict(result.raw or {}),
        )

    @classmethod
    def rejected(cls, error: Any) -> "OrderExecutionResult":
        return cls(success=False, status="rejected", error=str(error or "order rejected"))


class MarketOrderExecutor:
    """Submit a normalized market order through an adapter."""

    execution_algo = "market"

    def __init__(self, adapter: ExchangeOrderAdapter, *, max_wait_sec: float = 12.0):
        self.adapter = adapter
        self.max_wait_sec = max(0.0, float(max_wait_sec or 0.0))

    def execute(self, intent: OrderIntent) -> OrderExecutionResult:
        try:
            result = self.adapter.place_market_order(intent)
        except LiveTradingError as exc:
            return OrderExecutionResult.rejected(exc)
        try:
            fill = self.adapter.wait_for_fill(
                intent,
                order_id=result.exchange_order_id,
                max_wait_sec=self.max_wait_sec,
            )
            if fill:
                return OrderExecutionResult(
                    success=True,
                    exchange_id=str(result.exchange_id or ""),
                    exchange_order_id=str(result.exchange_order_id or ""),
                    filled_qty=float(fill.filled_qty or result.filled or 0.0),
                    avg_price=float(fill.avg_price or result.avg_price or 0.0),
                    status=fill.status or "submitted",
                    raw={"place": dict(result.raw or {}), "fill": dict(fill.raw or {})},
                    fees_by_ccy=dict(fill.fees_by_ccy or {}),
                )
            status = "filled" if float(result.filled or 0.0) > 0 else "submitted"
            return OrderExecutionResult.from_live_order(result, status=status)
        except Exception as exc:
            return replace(
                OrderExecutionResult.from_live_order(result),
                raw={"place": dict(result.raw or {}), "reconciliation_error": str(exc)},
            )


class RestingLimitExecutor:
    """Submit a durable limit order without cancelling or crossing the spread."""

    execution_algo = "limit"

    def __init__(self, adapter: ExchangeOrderAdapter):
        self.adapter = adapter

    def execute(self, intent: OrderIntent) -> OrderExecutionResult:
        if float(intent.price or 0.0) <= 0:
            return OrderExecutionResult.rejected("limit_price_required")
        try:
            result = self.adapter.place_limit_order(intent)
            status = "filled" if float(result.filled or 0.0) >= float(intent.quantity or 0.0) > 0 else "submitted"
            return OrderExecutionResult.from_live_order(result, status=status)
        except LiveTradingError as exc:
            return OrderExecutionResult.rejected(exc)


class LimitThenMarketExecutor:
    """Try a limit order first, then optionally fall back to market."""

    execution_algo = "limit_then_market"

    def __init__(
        self,
        adapter: ExchangeOrderAdapter,
        *,
        max_wait_sec: float = 15.0,
        fallback_to_market: bool = True,
    ):
        self.adapter = adapter
        self.max_wait_sec = max(0.0, float(max_wait_sec or 0.0))
        self.fallback_to_market = bool(fallback_to_market)

    def execute(self, intent: OrderIntent) -> OrderExecutionResult:
        if float(intent.price or 0.0) <= 0:
            return MarketOrderExecutor(self.adapter).execute(intent)
        result = None
        fill = None
        try:
            result = self.adapter.place_limit_order(intent)
            fill = self.adapter.wait_for_fill(
                intent,
                order_id=result.exchange_order_id,
                max_wait_sec=self.max_wait_sec,
            )
            limit_filled = max(float(result.filled or 0.0), float(fill.filled_qty or 0.0) if fill else 0.0)
            if _is_complete(fill, requested_qty=float(intent.quantity or 0.0)):
                return _limit_result(result, fill)
            if not self.fallback_to_market:
                return _limit_result(result, fill)
            self.adapter.cancel_order(intent, order_id=result.exchange_order_id)
            confirmed = self.adapter.wait_for_fill(
                intent, order_id=result.exchange_order_id, max_wait_sec=self.max_wait_sec,
            )
            if confirmed is None or float(confirmed.filled_qty or 0.0) < limit_filled:
                return _limit_result(result, fill, pending=True)
            fill = confirmed
            limit_filled = float(fill.filled_qty or 0.0)
            if normalize_live_order_status(fill.status) not in ("filled", "cancelled"):
                return _limit_result(result, fill, pending=True)
            if limit_filled > 0 and float(fill.avg_price or 0.0) <= 0:
                return _limit_result(result, fill, pending=True)
            remaining_qty = max(0.0, float(intent.quantity or 0.0) - limit_filled)
            if remaining_qty <= 0 or _is_complete(fill, requested_qty=float(intent.quantity or 0.0)):
                return _limit_result(result, fill)
            market_intent = replace(
                intent,
                quantity=remaining_qty,
                price=0.0,
                client_order_id=intent.fallback_client_order_id or intent.client_order_id,
                quote_amount=max(0.0, float(intent.quote_amount or 0.0) - limit_filled * float(fill.avg_price or 0.0)),
            )
            if float(intent.quote_amount or 0.0) > 0 and market_intent.quote_amount <= 0:
                return _limit_result(result, fill)
            market = MarketOrderExecutor(self.adapter).execute(market_intent)
            if not market.success:
                settled_limit = _limit_result(result, fill)
                return replace(
                    settled_limit,
                    raw={**settled_limit.raw, "market_error": market.error},
                )
            total_qty = limit_filled + float(market.filled_qty or 0.0)
            limit_avg = float(fill.avg_price or 0.0) if fill else 0.0
            market_avg = float(market.avg_price or 0.0)
            avg_price = _weighted_avg(
                (limit_filled, limit_avg),
                (float(market.filled_qty or 0.0), market_avg),
            )
            return OrderExecutionResult(
                success=market.success,
                exchange_id=market.exchange_id or str(result.exchange_id or ""),
                exchange_order_id=market.exchange_order_id or str(result.exchange_order_id or ""),
                filled_qty=total_qty,
                avg_price=avg_price,
                status=market.status or "submitted",
                error=market.error,
                fees_by_ccy=_merge_fee_breakdowns(
                    dict((fill.fees_by_ccy if fill else {}) or {}),
                    dict(market.fees_by_ccy or {}),
                ),
                raw={
                    "limit_place": dict(result.raw or {}),
                    "limit_fill": dict((fill.raw if fill else {}) or {}),
                    "limit_summary": {
                        "exchange_order_id": str(result.exchange_order_id or ""),
                        "filled_qty": limit_filled,
                        "avg_price": limit_avg,
                    },
                    "market": dict(market.raw or {}),
                    "market_summary": {
                        "exchange_order_id": str(market.exchange_order_id or ""),
                        "filled_qty": float(market.filled_qty or 0.0),
                        "avg_price": market_avg,
                    },
                },
            )
        except Exception as exc:
            if result is not None:
                deferred = _limit_result(result, fill, pending=True)
                return replace(deferred, raw={**deferred.raw, "reconciliation_error": str(exc)})
            if isinstance(exc, LiveTradingError):
                return OrderExecutionResult.rejected(exc)
            raise


def _limit_result(result: LiveOrderResult, fill: Optional[FillSnapshot], *, pending: bool = False) -> OrderExecutionResult:
    quantity = max(float(result.filled or 0.0), float(fill.filled_qty or 0.0) if fill else 0.0)
    average = float(fill.avg_price or result.avg_price or 0.0) if fill else float(result.avg_price or 0.0)
    return OrderExecutionResult(
        success=True,
        exchange_id=str(result.exchange_id or ""),
        exchange_order_id=str(result.exchange_order_id or ""),
        filled_qty=quantity,
        avg_price=average,
        status="submitted" if pending else (fill.status if fill else "") or "submitted",
        fees_by_ccy=dict(fill.fees_by_ccy or {}) if fill else {},
        raw={
            "limit_place": dict(result.raw or {}),
            "limit_fill": dict(fill.raw or {}) if fill else {},
            "limit_summary": {"exchange_order_id": str(result.exchange_order_id or ""),
                              "filled_qty": quantity, "avg_price": average},
        },
    )


def _is_complete(fill: Optional[FillSnapshot], *, requested_qty: float) -> bool:
    if fill is None:
        return False
    status = str(fill.status or "").strip().lower()
    if status in ("filled", "closed", "complete"):
        return True
    filled = float(fill.filled_qty or 0.0)
    return requested_qty > 0 and filled >= requested_qty * 0.999999


def _weighted_avg(*fills: tuple[float, float]) -> float:
    total_qty = sum(max(0.0, float(qty or 0.0)) for qty, _ in fills)
    if total_qty <= 0:
        return 0.0
    notional = 0.0
    for qty, price in fills:
        q = max(0.0, float(qty or 0.0))
        p = max(0.0, float(price or 0.0))
        notional += q * p
    return notional / total_qty if notional > 0 else 0.0


def _merge_fee_breakdowns(*items: Dict[str, float]) -> Dict[str, float]:
    merged: Dict[str, float] = {}
    for item in items:
        for currency, amount in (item or {}).items():
            try:
                fee = abs(float(amount or 0.0))
            except (TypeError, ValueError):
                fee = 0.0
            if fee <= 0:
                continue
            key = str(currency or "").strip().upper() or "UNKNOWN"
            merged[key] = merged.get(key, 0.0) + fee
    return merged
