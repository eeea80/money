"""Quick trade order helper functions."""

from __future__ import annotations

from typing import Any, Dict

from app.utils.logger import get_logger

logger = get_logger(__name__)


def enrich_fill(
    client: Any,
    *,
    order_id: str,
    symbol: str,
    market_type: str,
    max_wait_sec: float = 8.0,
) -> Dict[str, Any]:
    """Best-effort post-place fill enrichment for a Quick Trade order."""
    out = {"filled": 0.0, "avg_price": 0.0, "fee": 0.0, "fee_ccy": "", "status": ""}
    oid = str(order_id or "").strip()
    if not oid:
        return out
    sym = str(symbol or "")
    market = (market_type or "swap").strip().lower()
    try:
        from app.services.live_trading.gate import GateSpotClient, GateUsdtFuturesClient
        from app.services.live_trading.okx import OkxClient
        from app.services.live_trading.symbols import to_gate_currency_pair

        fill_result: Dict[str, Any] = {}
        if isinstance(client, OkxClient):
            fill_result = client.wait_for_fill(
                symbol=sym,
                ord_id=oid,
                market_type=market,
                max_wait_sec=max_wait_sec,
            )
        elif isinstance(client, GateSpotClient):
            fill_result = client.wait_for_fill(order_id=oid, symbol=sym, max_wait_sec=max_wait_sec)
        elif isinstance(client, GateUsdtFuturesClient):
            fill_result = client.wait_for_fill(
                order_id=oid,
                contract=to_gate_currency_pair(sym),
                max_wait_sec=max_wait_sec,
            )
        elif hasattr(client, "wait_for_fill"):
            try:
                fill_result = client.wait_for_fill(order_id=oid, max_wait_sec=max_wait_sec)
            except TypeError:
                try:
                    fill_result = client.wait_for_fill(symbol=sym, order_id=oid, max_wait_sec=max_wait_sec)
                except Exception as exc:
                    logger.info(
                        "enrich_fill: client %s wait_for_fill failed: %s",
                        type(client).__name__,
                        exc,
                    )
                    return out
        else:
            return out

        if isinstance(fill_result, dict):
            try:
                out["filled"] = float(fill_result.get("filled") or 0.0)
            except Exception:
                out["filled"] = 0.0
            try:
                out["avg_price"] = float(fill_result.get("avg_price") or 0.0)
            except Exception:
                out["avg_price"] = 0.0
            try:
                out["fee"] = abs(float(fill_result.get("fee") or 0.0))
            except Exception:
                out["fee"] = 0.0
            out["fee_ccy"] = str(fill_result.get("fee_ccy") or "").strip()
            out["status"] = str(
                fill_result.get("status")
                or fill_result.get("state")
                or fill_result.get("orderStatus")
                or ""
            ).strip().lower()
    except Exception as exc:
        logger.info("enrich_fill skipped: %s", exc)
    return out


def quick_order_status(
    *,
    requested_qty: float,
    filled_qty: float,
    exchange_status: str = "",
) -> str:
    """Map exchange cumulative fill state without treating partial fills as final."""
    status = str(exchange_status or "").strip().lower().replace("-", "_")
    if status in {"filled", "closed", "complete", "completed", "full_fill"}:
        return "filled"
    if status in {"cancelled", "canceled", "expired"}:
        return "cancelled"
    if status in {"rejected", "failed"}:
        return "failed"
    requested = max(0.0, float(requested_qty or 0.0))
    filled = max(0.0, float(filled_qty or 0.0))
    if requested > 0 and filled >= requested * 0.999999:
        return "filled"
    if filled > 0:
        return "partially_filled"
    return "submitted"


def attach_quick_trade_protection(
    client: Any,
    *,
    symbol: str,
    side: str,
    filled_qty: float,
    avg_price: float,
    tp_price: float,
    sl_price: float,
    market_type: str,
    exchange_config: Dict[str, Any],
    leverage: float,
    margin_mode: str,
    client_order_id: str,
) -> list[Dict[str, Any]]:
    """Attach native protection to the filled part of a Quick Trade entry."""
    if str(market_type or "").strip().lower() != "swap":
        return []
    if float(filled_qty or 0.0) <= 0 or float(avg_price or 0.0) <= 0:
        return []
    if float(tp_price or 0.0) <= 0 and float(sl_price or 0.0) <= 0:
        return []
    from app.services.live_trading.native_protection import (
        NativeProtectionRequest,
        place_native_protection_orders,
    )

    cfg = exchange_config if isinstance(exchange_config, dict) else {}
    request = NativeProtectionRequest(
        symbol=str(symbol),
        pos_side="long" if str(side or "").lower() == "buy" else "short",
        quantity=float(filled_qty),
        entry_price=float(avg_price),
        stop_loss_price=float(sl_price or 0.0),
        take_profit_price=float(tp_price or 0.0),
        margin_mode="isolated" if str(margin_mode).lower() in ("isolated", "iso") else "cross",
        leverage=float(leverage or 1.0),
        product_type=str(cfg.get("product_type") or cfg.get("productType") or "USDT-FUTURES"),
        margin_coin=str(cfg.get("margin_coin") or cfg.get("marginCoin") or "USDT"),
        client_order_id=str(client_order_id or ""),
    )
    return place_native_protection_orders(client, request)


def limit_order_kwargs(client, symbol, amount, price, side, market_type, client_order_id):
    """Build kwargs compatible with any exchange client's place_limit_order."""
    from app.services.live_trading.binance import BinanceFuturesClient
    from app.services.live_trading.binance_spot import BinanceSpotClient
    from app.services.live_trading.bybit import BybitClient
    from app.services.live_trading.okx import OkxClient

    if isinstance(client, (BinanceFuturesClient, BinanceSpotClient)):
        return {"quantity": amount, "price": price, "client_order_id": client_order_id}
    if isinstance(client, OkxClient):
        kwargs = {
            "market_type": market_type,
            "size": amount,
            "price": price,
            "client_order_id": client_order_id,
        }
        if market_type and market_type.strip().lower() != "spot":
            kwargs["pos_side"] = "long" if side.lower() == "buy" else "short"
        return kwargs
    if isinstance(client, BybitClient):
        return {"qty": amount, "price": price, "client_order_id": client_order_id}
    return {"size": amount, "price": price, "client_order_id": client_order_id}
