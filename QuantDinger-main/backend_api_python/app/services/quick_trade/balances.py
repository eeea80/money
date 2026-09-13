"""Quick trade balance fetch and parsing helpers."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.utils.logger import get_logger

logger = get_logger(__name__)


def empty_balance_dict() -> Dict[str, Any]:
    """Return the normalized empty USDT balance shape."""
    return {"available": 0.0, "total": 0.0, "currency": "USDT"}


def fetch_balance_raw(
    client: Any,
    *,
    exchange_id: str,
    market_type: str,
    exchange_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Fetch and parse USDT available balance for one market type."""
    from app.services.live_trading.bitget import BitgetMixClient
    from app.services.live_trading.bitget_spot import BitgetSpotClient
    from app.services.live_trading.bybit import BybitClient

    exchange = (exchange_id or "").strip().lower()
    market = (market_type or "swap").strip().lower()
    cfg = exchange_config if isinstance(exchange_config, dict) else {}
    result = empty_balance_dict()
    raw: Any = None

    try:
        if isinstance(client, BitgetSpotClient) and hasattr(client, "get_assets"):
            raw = client.get_assets()
            return parse_balance(raw, exchange_id, market_type)
        if hasattr(client, "get_balance"):
            raw = client.get_balance()
            return parse_balance(raw, exchange_id, market_type)
        if hasattr(client, "get_account"):
            raw = client.get_account()
            return parse_balance(raw, exchange_id, market_type)
        if hasattr(client, "get_accounts"):
            if isinstance(client, BitgetMixClient):
                product_type = str(cfg.get("product_type") or cfg.get("productType") or "USDT-FUTURES")
                raw = client.get_accounts(product_type=product_type)
            else:
                raw = client.get_accounts()
            return parse_balance(raw, exchange_id, market_type)
        if hasattr(client, "get_wallet_balance"):
            if isinstance(client, BybitClient):
                account_types = ("UNIFIED", "SPOT") if market == "spot" else ("UNIFIED", "CONTRACT", "FUND")
                for account_type in account_types:
                    try:
                        raw = client.get_wallet_balance(account_type=account_type)
                        parsed = parse_balance(raw, exchange_id, market_type)
                        if float(parsed.get("available") or 0) > 0 or float(parsed.get("total") or 0) > 0:
                            return parsed
                        result = parsed
                    except Exception:
                        continue
                return result
            raw = client.get_wallet_balance()
            return parse_balance(raw, exchange_id, market_type)
        if exchange == "bitget" and market == "spot" and hasattr(client, "get_assets"):
            raw = client.get_assets()
            return parse_balance(raw, exchange_id, market_type)
    except Exception as exc:
        logger.warning("Balance fetch failed (%s/%s): %s", exchange, market, exc)
        result = empty_balance_dict()
        result["error"] = str(exc)
        return result

    logger.warning(
        "No balance API on client %s for %s/%s",
        type(client).__name__,
        exchange,
        market,
    )
    return result


def parse_balance(raw: Any, exchange_id: str, market_type: str) -> Dict[str, Any]:
    """Best-effort parse balance from various exchange responses."""
    result = {"available": 0, "total": 0, "currency": "USDT"}
    exchange = (exchange_id or "").strip().lower()
    market = (market_type or "").strip().lower()

    def num(value: Any) -> float:
        try:
            text = str(value).replace(",", "").strip()
            if not text:
                return 0.0
            return float(text)
        except Exception:
            return 0.0

    if not raw:
        return result
    try:
        if isinstance(raw, list) and exchange == "gate":
            for item in raw:
                if not isinstance(item, dict):
                    continue
                if str(item.get("currency") or "").upper() == "USDT":
                    available = num(item.get("available") or item.get("available_balance"))
                    locked = num(item.get("locked") or item.get("freeze") or item.get("locked_amount"))
                    result["available"] = available
                    result["total"] = available + locked
                    return result
            return result

        if isinstance(raw, dict):
            if "availableBalance" in raw:
                result["available"] = float(raw.get("availableBalance") or 0)
                result["total"] = float(raw.get("totalWalletBalance") or raw.get("totalMarginBalance") or 0)
                return result

            if "balances" in raw:
                for item in raw.get("balances", []):
                    if str(item.get("asset") or "").upper() == "USDT":
                        result["available"] = float(item.get("free") or 0)
                        result["total"] = float(item.get("free") or 0) + float(item.get("locked") or 0)
                        return result
                return result

            if exchange == "gate" and market != "spot":
                gate_keys = (
                    "available", "total", "cross_available", "cross_margin_balance",
                    "available_margin", "margin_available",
                )
                if any(key in raw for key in gate_keys):
                    available = (
                        raw.get("available")
                        or raw.get("available_balance")
                        or raw.get("cross_available")
                        or raw.get("available_margin")
                        or raw.get("margin_available")
                    )
                    total = (
                        raw.get("total")
                        or raw.get("total_balance")
                        or raw.get("cross_margin_balance")
                        or raw.get("equity")
                        or raw.get("margin_balance")
                    )
                    result["available"] = num(available)
                    result["total"] = num(total) if total is not None and str(total).strip() != "" else result["available"]
                    if result["total"] <= 0 < result["available"]:
                        result["total"] = result["available"]
                    return result

            if exchange == "bitget" and market != "spot":
                data = raw.get("data")
                if isinstance(data, list) and data:
                    row = None
                    for item in data:
                        if isinstance(item, dict) and str(item.get("marginCoin") or "").upper() == "USDT":
                            row = item
                            break
                    if row is None and isinstance(data[0], dict):
                        row = data[0]
                    if isinstance(row, dict):
                        available = (
                            row.get("available")
                            or row.get("availableBalance")
                            or row.get("crossedMaxAvailable")
                            or row.get("isolatedMaxAvailable")
                            or 0
                        )
                        equity = row.get("accountEquity") or row.get("usdtEquity") or row.get("equity") or available
                        result["available"] = float(available or 0)
                        result["total"] = float(equity or 0) if equity is not None else result["available"]
                        return result

            if exchange == "bitget" and market == "spot":
                data = raw.get("data")
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and str(item.get("coin") or "").upper() == "USDT":
                            available = float(item.get("available") or 0)
                            frozen = float(item.get("frozen") or item.get("locked") or 0)
                            result["available"] = available
                            result["total"] = available + frozen
                            return result
                    return result

            data = raw.get("data")
            if isinstance(data, list) and data:
                first = data[0] if isinstance(data[0], dict) else {}
                details = first.get("details", [])
                if isinstance(details, list) and details:
                    for item in details:
                        if str(item.get("ccy") or "").upper() == "USDT":
                            result["available"] = float(item.get("availBal") or item.get("availEq") or 0)
                            result["total"] = float(item.get("eq") or item.get("cashBal") or 0)
                            return result
                if "availBal" in first or "availEq" in first or "totalEq" in first or "adjEq" in first:
                    result["available"] = float(
                        first.get("availBal") or first.get("availEq") or first.get("adjEq") or first.get("totalEq") or 0
                    )
                    result["total"] = float(first.get("totalEq") or first.get("adjEq") or 0)
                    return result

            if "result" in raw:
                response_result = raw["result"]
                if isinstance(response_result, dict):
                    account_list = response_result.get("list", [])
                    if isinstance(account_list, list):
                        for account in account_list:
                            if not isinstance(account, dict):
                                continue
                            account_available = num(account.get("totalAvailableBalance"))
                            account_equity = num(account.get("totalEquity") or account.get("totalWalletBalance"))
                            if account_available > 0 or account_equity > 0:
                                result["available"] = account_available
                                result["total"] = account_equity if account_equity > 0 else account_available
                                return result
                            coins = account.get("coin", []) if isinstance(account, dict) else []
                            for coin in coins:
                                if str(coin.get("coin") or "").upper() == "USDT":
                                    wallet_balance = num(coin.get("walletBalance"))
                                    available = num(
                                        coin.get("availableBalance")
                                        or coin.get("availableToWithdraw")
                                        or coin.get("free")
                                    ) or wallet_balance
                                    equity = num(coin.get("equity")) or wallet_balance
                                    result["available"] = available
                                    result["total"] = equity if equity > 0 else (wallet_balance if wallet_balance > 0 else available)
                                    if result["available"] > 0 or result["total"] > 0:
                                        return result

            if isinstance(data, dict) and isinstance(data.get("list"), list):
                for item in data.get("list") or []:
                    if str(item.get("currency") or "").upper() == "USDT" and str(item.get("type") or "").lower() in ("trade", "available", ""):
                        result["available"] = float(item.get("balance") or 0)
                total = 0.0
                for item in data.get("list") or []:
                    if str(item.get("currency") or "").upper() == "USDT":
                        total += float(item.get("balance") or 0)
                if total > 0 or result["available"] > 0:
                    result["total"] = total or result["available"]
                    return result

            if isinstance(data, list) and data and isinstance(data[0], dict):
                first = data[0]
                if any(key in first for key in ("margin_available", "margin_balance", "withdraw_available")):
                    sum_available = 0.0
                    sum_total = 0.0
                    for item in data:
                        if not isinstance(item, dict):
                            continue
                        sum_available += num(item.get("margin_available") or item.get("withdraw_available"))
                        sum_total += num(item.get("margin_balance") or item.get("margin_static"))
                    result["available"] = sum_available
                    result["total"] = sum_total if sum_total > 0 else sum_available
                    logger.info(
                        "HTX swap balance parsed: available=%.4f total=%.4f (from %d items)",
                        sum_available,
                        sum_total,
                        len(data),
                    )
                    return result
            elif isinstance(data, dict) and ("margin_balance" in data or "margin_available" in data or "withdraw_available" in data):
                result["available"] = num(data.get("margin_available") or data.get("withdraw_available"))
                result["total"] = num(data.get("margin_balance") or data.get("margin_static"))
                if result["total"] <= 0 < result["available"]:
                    result["total"] = result["available"]
                return result

        if isinstance(raw, dict):
            for key, value in raw.items():
                if "avail" in str(key).lower() and isinstance(value, (int, float)):
                    result["available"] = float(value)
                if "total" in str(key).lower() and isinstance(value, (int, float)):
                    result["total"] = float(value)
    except Exception as exc:
        logger.warning("parse_balance error: %s", exc)
    return result
