"""Preflight position ownership checks for derivative entry orders."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict

from app.services.live_trading.position_ownership import (
    DEFAULT_SHORTFALL_RELATIVE_TOLERANCE,
    evaluate_and_record_ownership,
    normalize_market_type,
    ownership_log_message,
    DEFAULT_DRIFT_QUOTE_TOLERANCE,
    quote_drift_tolerance,
)
from app.services.live_trading.position_query import query_exchange_position_size
from app.services.live_trading.records import (
    fetch_allocated_position_size,
    fetch_position_size_for_side,
)
from app.services.grid.exchange_requirements import detect_hedge_position_mode
from app.services.strategy_live_guard import resolve_strategy_direction_mode


@dataclass(frozen=True)
class EntryPositionGuardResult:
    """Result consumed by the pending-order worker without worker side effects."""

    ownership: Dict[str, Any] = field(default_factory=dict)
    error: str = ""
    log_level: str = ""
    log_message: str = ""


def strategy_allows_simultaneous_legs(strategy: Dict[str, Any]) -> bool:
    """Return whether one strategy intentionally owns both derivative legs."""
    return resolve_strategy_direction_mode(strategy) in {"both", "neutral"}


def evaluate_entry_position_guard(
    *,
    client: Any,
    strategy_id: int,
    user_id: int,
    credential_id: int,
    exchange_id: str,
    market_type: str,
    symbol: str,
    side: str,
    strategy_config: Dict[str, Any],
    exchange_config: Dict[str, Any],
    account_qty: float,
    reference_price: float = 0.0,
) -> EntryPositionGuardResult:
    """Validate ownership drift and an optional opposite strategy leg."""
    strategy_qty = fetch_allocated_position_size(
        strategy_id=int(strategy_id),
        credential_id=int(credential_id or 0),
        market_type=str(market_type),
        symbol=str(symbol),
        side=str(side),
    )
    trading_config = strategy_config.get("trading_config") if isinstance(strategy_config.get("trading_config"), dict) else {}
    try:
        dust_quote = float(
            trading_config.get("position_drift_tolerance_quote")
            or strategy_config.get("position_drift_tolerance_quote")
            or DEFAULT_DRIFT_QUOTE_TOLERANCE
        )
    except (TypeError, ValueError):
        dust_quote = DEFAULT_DRIFT_QUOTE_TOLERANCE
    dust_quote = min(DEFAULT_DRIFT_QUOTE_TOLERANCE, max(0.0, dust_quote))
    try:
        shortfall_ratio = float(
            trading_config.get("position_shortfall_tolerance_ratio")
            or strategy_config.get("position_shortfall_tolerance_ratio")
            or DEFAULT_SHORTFALL_RELATIVE_TOLERANCE
        )
    except (TypeError, ValueError):
        shortfall_ratio = DEFAULT_SHORTFALL_RELATIVE_TOLERANCE
    shortfall_ratio = min(0.02, max(0.001, shortfall_ratio))
    price = max(0.0, float(reference_price or 0.0))
    absolute_tolerance = quote_drift_tolerance(symbol, price, dust_quote)
    snapshot = evaluate_and_record_ownership(
        user_id=int(user_id or 1),
        credential_id=int(credential_id or 0),
        exchange_id=str(exchange_id or ""),
        market_type=str(market_type),
        symbol=str(symbol),
        side=str(side),
        account_qty=float(account_qty or 0.0),
        strategy_qty=float(strategy_qty or 0.0),
        absolute_tolerance=absolute_tolerance,
        shortfall_relative_tolerance=shortfall_ratio,
    )
    metadata = snapshot.metadata()
    if not snapshot.allowed:
        error = (
            "position_drift_detected:"
            f"side={side},account={snapshot.account_qty},strategy={snapshot.strategy_qty},"
            f"protected={snapshot.protected_qty},unknown={snapshot.unknown_qty},"
            f"mode={snapshot.coexistence_mode}"
        )
        return EntryPositionGuardResult(
            ownership=metadata,
            error=error,
            log_level="error" if snapshot.should_log else "",
            log_message=ownership_log_message(snapshot) if snapshot.should_log else "",
        )

    # Spot has only the long inventory lane.  Its ownership baseline and drift
    # rules are identical to swap, but there is no opposite exchange leg to
    # inspect before an entry.
    if normalize_market_type(market_type) == "spot":
        return EntryPositionGuardResult(ownership=metadata)

    if strategy_allows_simultaneous_legs(strategy_config):
        return EntryPositionGuardResult(ownership=metadata)

    opposite_side = "short" if str(side) == "long" else "long"
    local_opposite = fetch_position_size_for_side(int(strategy_id), str(symbol), opposite_side)
    try:
        live_opposite = float(
            query_exchange_position_size(
                client=client,
                symbol=str(symbol),
                pos_side=opposite_side,
                market_type=str(market_type),
                exchange_config=exchange_config,
                strict=True,
            )
            or 0.0
        )
    except Exception as exc:
        return EntryPositionGuardResult(
            ownership=metadata,
            error=f"opposite_position_snapshot_failed:{exc}",
        )
    if live_opposite <= 1e-8:
        return EntryPositionGuardResult(ownership=metadata)
    if local_opposite <= 1e-8:
        try:
            is_hedge, mode_label = detect_hedge_position_mode(
                client,
                symbol=str(symbol),
                market_type=str(market_type),
                exchange_config=exchange_config,
            )
        except Exception as exc:
            return EntryPositionGuardResult(
                ownership=metadata,
                error=f"position_mode_snapshot_failed:{exc}",
            )
        if is_hedge is True:
            return EntryPositionGuardResult(ownership=metadata)
        return EntryPositionGuardResult(
            ownership=metadata,
            error=(
                "opposite_account_inventory_would_be_netted:"
                f"side={opposite_side},exchange={live_opposite},mode={mode_label}"
            ),
            log_level="warning",
            log_message=(
                f"Entry rejected because one-way position mode would net opposite "
                f"account inventory: {symbol}"
            ),
        )
    return EntryPositionGuardResult(
        ownership=metadata,
        error=(
            "opposite_position_still_open:"
            f"side={opposite_side},exchange={live_opposite},local={local_opposite}"
        ),
        log_level="warning",
        log_message=f"Reverse entry rejected until the opposite position is fully closed: {symbol}",
    )
