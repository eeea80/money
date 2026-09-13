"""Resolve close/reduce quantities without crossing strategy ownership."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from app.services.live_trading.records import (
    fetch_allocated_position_size,
    fetch_position_size_for_side,
    normalize_strategy_symbol,
)
from app.services.live_trading.symbols import (
    to_bitget_um_symbol,
    to_gate_currency_pair,
    to_okx_swap_inst_id,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)


def symbols_equivalent(a: str, b: str) -> bool:
    na = normalize_strategy_symbol(a)
    nb = normalize_strategy_symbol(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    return na.replace("/", "") == nb.replace("/", "")


from app.services.live_trading.position_row_parse import (
    infer_position_side_from_row,
    position_base_qty_for_side,
)


def query_exchange_position_size(
    *,
    client: Any,
    symbol: str,
    pos_side: str,
    market_type: str,
    exchange_config: Optional[Dict[str, Any]] = None,
    strict: bool = False,
) -> float:
    """
    Best-effort base-asset position size on the connected exchange for ``pos_side``.
    Returns 0.0 when unknown or flat.
    """
    if client is None:
        return 0.0
    side = str(pos_side or "").strip().lower()
    if side not in ("long", "short"):
        return 0.0
    mt = str(market_type or "swap").strip().lower()
    cfg = exchange_config if isinstance(exchange_config, dict) else {}
    sym = str(symbol or "").strip()

    # Spot ownership is the complete base inventory.  Sell sizing has a
    # separate free/available clamp because locked balances are still owned.
    if mt == "spot":
        if side != "long":
            return 0.0
        try:
            from app.services.live_trading.spot_sizing import get_spot_total_base_balance

            return max(
                0.0,
                float(
                    get_spot_total_base_balance(
                        client,
                        symbol=sym,
                        strict=strict,
                    )
                    or 0.0
                ),
            )
        except Exception as e:
            if strict:
                raise
            logger.debug("spot total balance query failed symbol=%s: %s", sym, e)
            return 0.0

    try:
        from app.services.live_trading.binance import BinanceFuturesClient
        from app.services.live_trading.okx import OkxClient
        from app.services.live_trading.bybit import BybitClient
        from app.services.live_trading.bitget import BitgetMixClient
        from app.services.live_trading.gate import GateUsdtFuturesClient
        from app.services.live_trading.htx import HtxClient
    except Exception:
        if strict:
            raise
        return 0.0

    if isinstance(client, OkxClient):
        from app.services.grid.fill_units import okx_swap_position_base_size

        inst_id = to_okx_swap_inst_id(sym)
        pos_resp = client.get_positions(inst_id=inst_id) or {}
        pos_data = (pos_resp.get("data") or []) if isinstance(pos_resp, dict) else []
        for pos in pos_data:
            if not isinstance(pos, dict):
                continue
            if str(pos.get("instId") or "").strip() != inst_id:
                continue
            if infer_position_side_from_row(pos) != side:
                continue
            qty = okx_swap_position_base_size(pos, client=client)
            if qty > 0:
                return qty
        return 0.0

    if isinstance(client, BinanceFuturesClient):
        norm_sym = sym.replace("/", "").replace("-", "").upper()
        pos_list = client.get_positions() or []
        if isinstance(pos_list, dict) and "raw" in pos_list:
            pos_list = pos_list["raw"]
        if not isinstance(pos_list, list):
            return 0.0
        for pos in pos_list:
            if not isinstance(pos, dict):
                continue
            if str(pos.get("symbol") or "").upper() != norm_sym:
                continue
            qty = position_base_qty_for_side(pos, side)
            if qty > 0:
                return qty
        return 0.0

    if isinstance(client, BybitClient):
        pos_resp = client.get_positions(symbol=sym) or {}
        pos_list = (pos_resp.get("result") or {}).get("list") or [] if isinstance(pos_resp, dict) else []
        want = sym.replace("/", "").replace("-", "").upper()
        for pos in pos_list:
            if not isinstance(pos, dict):
                continue
            if str(pos.get("symbol") or "").strip().upper() != want:
                continue
            qty = position_base_qty_for_side(pos, side)
            if qty > 0:
                return qty
        return 0.0

    if isinstance(client, BitgetMixClient):
        product_type = str(cfg.get("product_type") or cfg.get("productType") or "USDT-FUTURES")
        pos_resp = client.get_positions(product_type=product_type, symbol=sym) or {}
        pos_list = (pos_resp.get("data") or []) if isinstance(pos_resp, dict) else []
        want = to_bitget_um_symbol(sym).upper()
        for pos in pos_list:
            if not isinstance(pos, dict):
                continue
            if to_bitget_um_symbol(str(pos.get("symbol") or "")).upper() != want:
                continue
            qty = position_base_qty_for_side(pos, side)
            if qty > 0:
                return qty
        return 0.0

    if isinstance(client, GateUsdtFuturesClient):
        resp = client.get_positions()
        items = resp if isinstance(resp, list) else []
        want_contract = to_gate_currency_pair(sym)
        for p in items:
            if not isinstance(p, dict):
                continue
            contract = str(p.get("contract") or "").strip()
            if contract != want_contract and not symbols_equivalent(contract.replace("_", "/"), sym):
                continue
            qm = 1.0
            try:
                meta = client.get_contract(contract=contract) or {}
                qm = float(meta.get("quanto_multiplier") or meta.get("contract_size") or 0.0) or 1.0
            except Exception:
                qm = 1.0
            qty_base = position_base_qty_for_side(p, side, contracts_to_base=qm)
            if qty_base > 0:
                return float(qty_base)
        return 0.0

    if isinstance(client, HtxClient):
        resp = client.get_positions(symbol=sym) or {}
        data = (resp.get("data") or []) if isinstance(resp, dict) else []
        contract_size = 1.0
        if getattr(client, "market_type", "swap") != "spot":
            try:
                info = client.get_contract_info(symbol=sym) or {}
                cs = float(info.get("contract_size") or info.get("contractSize") or 0.0)
                if cs > 0:
                    contract_size = cs
            except Exception:
                pass
        for p in data:
            if not isinstance(p, dict):
                continue
            contract = str(p.get("contract_code") or p.get("symbol") or "")
            if sym and contract and not symbols_equivalent(contract.replace("-", "/"), sym):
                continue
            mult = contract_size if getattr(client, "market_type", "swap") != "spot" else 1.0
            qty = position_base_qty_for_side(p, side, contracts_to_base=mult)
            if qty > 0:
                return qty
        return 0.0

    # IBKR / Alpaca broker clients.
    try:
        positions = client.get_positions() if hasattr(client, "get_positions") else []
    except Exception:
        if strict:
            raise
        positions = []
    if isinstance(positions, list):
        for p in positions:
            if not isinstance(p, dict):
                continue
            p_sym = str(
                p.get("symbol")
                or p.get("ib_symbol")
                or p.get("contract")
                or ""
            ).strip()
            if sym and p_sym and not symbols_equivalent(p_sym, sym):
                continue
            qty = position_base_qty_for_side(p, side)
            if qty > 0:
                return qty
    if strict:
        raise RuntimeError(f"position_query_not_supported:{type(client).__name__}")
    return 0.0


def _extract_position_rows(resp: Any) -> List[Any]:
    if isinstance(resp, list):
        return resp
    if not isinstance(resp, dict):
        return []
    for key in ("data", "list", "positions", "result"):
        chunk = resp.get(key)
        if isinstance(chunk, list):
            return chunk
        if isinstance(chunk, dict):
            nested = chunk.get("list") or chunk.get("data")
            if isinstance(nested, list):
                return nested
    return []


def resolve_reduce_only_quantity(
    *,
    strategy_id: int,
    symbol: str,
    pos_side: str,
    requested_amount: float,
    client: Any,
    market_type: str,
    exchange_config: Optional[Dict[str, Any]] = None,
    allow_exchange_fallback: bool = False,
    user_id: int = 0,
    credential_id: int = 0,
) -> Tuple[float, Dict[str, Any]]:
    """
    Choose a safe close/reduce base quantity.

    Strategy orders are capped by the strategy-owned L3 position ledger.  The
    exchange account position/balance is only a second safety cap and must not
    become the source quantity, because it can include a user's manual holdings
    or positions allocated to another strategy.

    ``allow_exchange_fallback`` is an explicit recovery-only escape hatch for
    callers that intentionally operate on the whole exchange position.
    """
    meta: Dict[str, Any] = {}
    amount = max(0.0, float(requested_amount or 0.0))
    meta["requested"] = amount

    db_size = fetch_position_size_for_side(int(strategy_id), symbol, pos_side)
    meta["db_size"] = db_size
    if db_size > 0:
        if amount <= 0:
            amount = db_size
            meta["filled_from"] = "db"
        elif amount > db_size:
            meta["capped_by"] = "db"
            amount = db_size
    else:
        meta["db_missing"] = True
        if not allow_exchange_fallback:
            amount = 0.0
            meta["blocked_by"] = "strategy_position_missing"

    exch_size = query_exchange_position_size(
        client=client,
        symbol=symbol,
        pos_side=pos_side,
        market_type=market_type,
        exchange_config=exchange_config,
    )
    meta["exchange_size"] = exch_size

    if exch_size > 0:
        if amount <= 0 and allow_exchange_fallback:
            amount = exch_size
            meta["filled_from"] = "exchange"
            logger.info(
                "[RiskControl] Close %s %s: no DB size; using exchange position=%s",
                symbol,
                pos_side,
                exch_size,
            )
        elif amount > exch_size:
            logger.info(
                "[RiskControl] Close %s %s: capping amount %s -> exchange position %s",
                symbol,
                pos_side,
                amount,
                exch_size,
            )
            meta["capped_by"] = "exchange"
            amount = exch_size
    elif amount <= 0:
        logger.warning(
            "[RiskControl] Close %s %s: no position in DB or on exchange (amount stays 0)",
            symbol,
            pos_side,
        )
        meta["filled_from"] = "none"

    # Reserve the allocations of other strategies sharing this account leg.
    # Account surplus belongs to the user automatically; this strategy may
    # still close its own ledger quantity without registering a manual floor.
    allocated = db_size
    if int(credential_id or 0) > 0:
        allocated = fetch_allocated_position_size(
            strategy_id=int(strategy_id),
            credential_id=int(credential_id),
            market_type=market_type,
            symbol=symbol,
            side=pos_side,
        )
    other_allocated = max(0.0, float(allocated or 0.0) - float(db_size or 0.0))
    available = max(0.0, float(exch_size or 0.0) - other_allocated)
    meta["account_allocated_size"] = allocated
    meta["other_strategy_allocated_size"] = other_allocated
    meta["exchange_strategy_available"] = available
    if amount > available:
        amount = available
        meta["capped_by"] = "account_allocation"

    meta["resolved"] = amount
    return amount, meta
