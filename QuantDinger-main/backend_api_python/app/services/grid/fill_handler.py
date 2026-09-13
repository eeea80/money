"""Update local DB after a grid resting order fills."""

from __future__ import annotations

from typing import Any, Dict

from app.services.grid.resting_orders_repo import GridRestingOrder
from app.services.live_trading.grid_cells import GridCellRepository
from app.services.live_trading.leg_context import resolve_leg_context
from app.services.live_trading.records import (
    apply_fill_to_local_position,
    normalize_strategy_symbol,
    record_trade,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)

_PURPOSE_TO_SIGNAL = {
    "long_entry": "open_long",
    "long_exit": "close_long",
    "short_entry": "open_short",
    "short_exit": "close_short",
}


def _matched_grid_entry_price(strategy_id: int, symbol: str, order: GridRestingOrder) -> float:
    """Best-effort cell cost basis for one grid close fill."""
    purpose = str(order.purpose or "")
    if purpose not in ("long_exit", "short_exit"):
        return 0.0
    try:
        repo = GridCellRepository()
        rows = repo.list_cells(int(strategy_id), str(symbol or ""))
        for cell in rows or []:
            if int(getattr(cell, "cell_index", -1)) != int(order.cell_index):
                continue
            entry = float(getattr(cell, "leg_entry_price", 0.0) or 0.0)
            if entry > 0:
                return entry
            if purpose == "long_exit":
                return float(getattr(cell, "lower_price", 0.0) or 0.0)
            return float(getattr(cell, "upper_price", 0.0) or 0.0)
    except Exception as e:
        logger.debug("grid matched entry lookup sid=%s cell=%s: %s", strategy_id, order.cell_index, e)
    return 0.0


def _grid_match_profit(purpose: str, entry_price: float, exit_price: float, qty: float) -> float | None:
    if entry_price <= 0 or exit_price <= 0 or qty <= 0:
        return None
    if purpose == "long_exit":
        return (exit_price - entry_price) * qty
    if purpose == "short_exit":
        return (entry_price - exit_price) * qty
    return None


def apply_grid_fill_to_local_state(
    strategy_id: int,
    symbol: str,
    order: GridRestingOrder,
    filled_qty: float,
    avg_price: float,
    trading_config: Dict[str, Any],
    *,
    commission: float = 0.0,
    commission_ccy: str = "",
    commission_quote: float | None = None,
    fee_status: str = "pending",
    fee_source: str = "",
    exchange_fill_id: str = "",
    execution_event_id: int = 0,
) -> None:
    sym = normalize_strategy_symbol(symbol)
    purpose = str(order.purpose or "")
    signal_type = _PURPOSE_TO_SIGNAL.get(purpose, "")
    if not signal_type:
        return
    px = float(avg_price or order.price or 0)
    qty = float(filled_qty or order.quantity or 0)
    if qty <= 0 or px <= 0:
        return
    tc = trading_config if isinstance(trading_config, dict) else {}
    grid_entry_price = _matched_grid_entry_price(int(strategy_id), sym, order)
    grid_profit = _grid_match_profit(purpose, grid_entry_price, px, qty)

    leg = resolve_leg_context(
        strategy_id=int(strategy_id),
        symbol=sym,
        market_type=str(tc.get("market_type") or "swap"),
        fill_source="grid_poller",
    )
    profit, _pos, matched_entry = apply_fill_to_local_position(
        strategy_id=int(strategy_id),
        symbol=sym,
        signal_type=signal_type,
        filled=qty,
        avg_price=px,
        leg=leg,
    )
    if grid_profit is not None:
        profit = grid_profit
        matched_entry = grid_entry_price
    record_trade(
        strategy_id=int(strategy_id),
        symbol=sym,
        trade_type=signal_type,
        price=px,
        amount=qty,
        commission=float(commission or 0.0),
        commission_ccy=str(commission_ccy or ""),
        commission_quote=commission_quote,
        profit=profit,
        close_reason=purpose,
        matched_entry_price=matched_entry,
        grid_matched_profit=(
            profit if purpose in ("long_exit", "short_exit") and profit is not None else None
        ),
        leg=leg,
        exchange_fill_id=str(exchange_fill_id or ""),
        execution_event_id=int(execution_event_id or 0),
        grid_order_id=int(order.id or 0),
        fee_status=str(fee_status or "pending"),
        fee_source=str(fee_source or ""),
    )


def record_grid_market_fill(
    strategy_id: int,
    symbol: str,
    signal_type: str,
    filled_qty: float,
    avg_price: float,
    trading_config: Dict[str, Any],
    *,
    reason: str = "",
    commission: float = 0.0,
    commission_ccy: str = "",
    commission_quote: float | None = None,
    exchange_order_id: str = "",
    client_order_id: str = "",
    exchange_id: str = "",
    user_id: int = 0,
    fee_status: str = "pending",
    fee_source: str = "rest",
) -> int:
    """Record a grid initial/risk market fill into L2/L3 ledgers."""
    sym = normalize_strategy_symbol(symbol)
    sig = str(signal_type or "").strip().lower()
    if not sig:
        return 0
    px = float(avg_price or 0)
    qty = float(filled_qty or 0)
    if qty <= 0 or px <= 0:
        return 0
    tc = trading_config if isinstance(trading_config, dict) else {}
    leg = resolve_leg_context(
        strategy_id=int(strategy_id),
        symbol=sym,
        market_type=str(tc.get("market_type") or "swap"),
        fill_source="grid_market",
    )
    profit, _pos, matched_entry = apply_fill_to_local_position(
        strategy_id=int(strategy_id),
        symbol=sym,
        signal_type=sig,
        filled=qty,
        avg_price=px,
        leg=leg,
    )
    trade_id = record_trade(
        strategy_id=int(strategy_id),
        symbol=sym,
        trade_type=sig,
        price=px,
        amount=qty,
        commission=float(commission or 0.0),
        commission_ccy=str(commission_ccy or ""),
        commission_quote=commission_quote,
        profit=profit,
        close_reason=str(reason or sig),
        matched_entry_price=matched_entry,
        leg=leg,
        fee_status=str(fee_status or "pending"),
        fee_source=str(fee_source or "rest"),
    )
    if trade_id and (exchange_order_id or client_order_id):
        try:
            from app.services.execution_streams.repository import ExecutionEventRepository

            ExecutionEventRepository().register_binding(
                credential_id=int(leg.credential_id or 0),
                exchange_id=str(
                    exchange_id or tc.get("exchange_id") or tc.get("exchange") or ""
                ),
                market_type=leg.normalized_market_type(),
                owner_type="grid_market",
                owner_id=int(trade_id),
                user_id=int(user_id or 1),
                strategy_id=int(strategy_id),
                symbol=sym,
                signal_type=sig,
                client_order_id=str(client_order_id or ""),
                exchange_order_id=str(exchange_order_id or ""),
                observed_filled=qty,
            )
        except Exception:
            logger.debug(
                "grid market execution binding failed trade_id=%s",
                trade_id,
                exc_info=True,
            )
    return int(trade_id or 0)
