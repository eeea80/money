"""Exchange quantity normalization and durable completion decisions."""

from __future__ import annotations

from typing import Any, Dict, Tuple

from app.services.pending_orders.sent_order_recovery import is_final_fill
from app.services.live_trading.symbols import (
    to_gate_currency_pair,
    to_okx_spot_inst_id,
    to_okx_swap_inst_id,
)
from app.services.instrument_rules import get_instrument_rules_provider


_instrument_rules = get_instrument_rules_provider()


def exchange_executable_base_quantity(
    client: Any,
    *,
    exchange_id: str,
    symbol: str,
    market_type: str,
    requested: float,
    exchange_config: Dict[str, Any],
) -> float:
    """Return the base quantity accepted after exchange step-size flooring."""
    quantity = max(0.0, float(requested or 0.0))
    exchange = str(exchange_id or "").strip().lower()
    market = str(market_type or "spot").strip().lower()
    try:
        rules = _instrument_rules.get_rules(
            symbol,
            exchange_id=exchange,
            market_type=market,
            client=client,
        )
        if rules.amount_step > 0 or rules.min_amount > 0:
            return rules.normalize_amount(quantity)
    except Exception:
        pass
    try:
        if exchange == "bitget" and market == "swap" and hasattr(client, "normalize_base_order_size"):
            product_type = str(
                exchange_config.get("product_type")
                or exchange_config.get("productType")
                or "USDT-FUTURES"
            )
            normalized = client.normalize_base_order_size(
                symbol=str(symbol),
                product_type=product_type,
                base_size=quantity,
            )
            return max(0.0, float(normalized or 0.0))
        if exchange == "bitget" and market == "spot" and hasattr(client, "_normalize_base_size"):
            normalized, _ = client._normalize_base_size(symbol=str(symbol), base_size=quantity)
            return max(0.0, float(normalized or 0.0))
        if exchange == "okx" and hasattr(client, "_normalize_order_size"):
            inst_id = to_okx_spot_inst_id(symbol) if market == "spot" else to_okx_swap_inst_id(symbol)
            normalized, _ = client._normalize_order_size(
                inst_id=inst_id,
                market_type=market,
                size=quantity,
            )
            executable = max(0.0, float(normalized or 0.0))
            if market != "spot" and executable > 0 and hasattr(client, "get_instrument"):
                instrument = client.get_instrument(inst_type="SWAP", inst_id=inst_id) or {}
                contract_value = max(0.0, float(instrument.get("ctVal") or 0.0))
                if contract_value > 0:
                    executable *= contract_value
            return executable
        if exchange in {"gate", "gateio"} and market == "swap" and hasattr(client, "_resolve_order_size"):
            contract = to_gate_currency_pair(symbol)
            contracts, _ = client._resolve_order_size(
                contract=contract,
                side="buy",
                base_size=quantity,
            )
            count = abs(float(contracts or 0.0))
            if count <= 0:
                return 0.0
            if hasattr(client, "contracts_signed_to_base_qty"):
                return max(
                    0.0,
                    float(client.contracts_signed_to_base_qty(
                        contract=contract,
                        contracts_signed=count,
                    ) or 0.0),
                )
        if exchange == "binance" and hasattr(client, "_normalize_quantity"):
            normalized, _ = client._normalize_quantity(
                symbol=str(symbol),
                quantity=quantity,
                for_market=True,
            )
            return max(0.0, float(normalized or 0.0))
        if exchange == "bybit" and hasattr(client, "_normalize_qty"):
            normalized, _ = client._normalize_qty(symbol=str(symbol), qty=quantity)
            return max(0.0, float(normalized or 0.0))
    except Exception:
        # Reconciliation must never guess a smaller executable amount when
        # exchange metadata is unavailable.  Keep the original request so a
        # later poll can retry with authoritative metadata or terminal status.
        return quantity
    return quantity


def exchange_quantity_snapshot(
    client: Any,
    *,
    exchange_id: str,
    symbol: str,
    market_type: str,
    requested: float,
    exchange_config: Dict[str, Any],
    source: str = "order_submission",
) -> Tuple[float, Dict[str, Any]]:
    executable = exchange_executable_base_quantity(
        client,
        exchange_id=exchange_id,
        symbol=symbol,
        market_type=market_type,
        requested=requested,
        exchange_config=exchange_config,
    )
    return executable, {
        "requested_base_qty": max(0.0, float(requested or 0.0)),
        "executable_base_qty": executable,
        "source": str(source or "order_submission"),
    }


def reconciled_queue_status(
    client: Any,
    *,
    exchange_id: str,
    symbol: str,
    market_type: str,
    requested: float,
    filled: float,
    avg_price: float,
    exchange_status: str,
    exchange_config: Dict[str, Any],
) -> Tuple[str, float]:
    executable = exchange_executable_base_quantity(
        client,
        exchange_id=exchange_id,
        symbol=symbol,
        market_type=market_type,
        requested=requested,
        exchange_config=exchange_config,
    )
    if is_final_fill(executable, filled, avg_price, exchange_status):
        return "filled", executable
    if str(exchange_status or "").strip().lower() == "cancelled":
        return "cancelled", executable
    return "sent", executable
