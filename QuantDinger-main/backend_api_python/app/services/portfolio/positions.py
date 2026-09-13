"""Portfolio position read-model helpers."""

from __future__ import annotations

from typing import Dict, Iterable, List


def enrich_positions_with_prices(positions: List[dict], price_map: Dict[str, dict]) -> List[dict]:
    """Attach price, value, and PnL fields to manual position rows."""
    for position in positions:
        key = f"{position['market']}:{position['symbol']}"
        price_data = price_map.get(key, {})

        current_price = float(price_data.get("price") or 0)
        entry_price = position["entry_price"]
        quantity = position["quantity"]
        side = position["side"]

        position["current_price"] = current_price
        position["price_change"] = price_data.get("change", 0)
        position["price_change_percent"] = price_data.get("changePercent", 0)
        position["market_value"] = current_price * quantity
        position["cost_value"] = entry_price * quantity

        if side == "long":
            position["pnl"] = (current_price - entry_price) * quantity
        else:
            position["pnl"] = (entry_price - current_price) * quantity

        if position["cost_value"] > 0:
            position["pnl_percent"] = round(position["pnl"] / position["cost_value"] * 100, 2)

    return positions


def summarize_position_rows(rows: Iterable[dict], price_map: Dict[str, dict]) -> dict:
    """Build portfolio summary totals and market distribution."""
    rows = list(rows)
    total_cost = 0
    total_market_value = 0
    total_pnl = 0
    market_values = {}

    for row in rows:
        market = row.get("market")
        symbol = row.get("symbol")
        side = row.get("side") or "long"
        quantity = float(row.get("quantity") or 0)
        entry_price = float(row.get("entry_price") or 0)

        key = f"{market}:{symbol}"
        price_data = price_map.get(key, {})
        current_price = float(price_data.get("price") or 0)

        cost = entry_price * quantity
        market_value = current_price * quantity

        if side == "long":
            pnl = (current_price - entry_price) * quantity
        else:
            pnl = (entry_price - current_price) * quantity

        total_cost += cost
        total_market_value += market_value
        total_pnl += pnl
        market_values[market] = market_values.get(market, 0) + market_value

    market_distribution = []
    for market, value in market_values.items():
        percent = round(value / total_market_value * 100, 2) if total_market_value > 0 else 0
        market_distribution.append({
            "market": market,
            "value": round(value, 2),
            "percent": percent,
        })
    market_distribution.sort(key=lambda item: item["value"], reverse=True)

    return {
        "total_cost": round(total_cost, 2),
        "total_market_value": round(total_market_value, 2),
        "total_pnl": round(total_pnl, 2),
        "total_pnl_percent": round(total_pnl / total_cost * 100, 2) if total_cost > 0 else 0,
        "position_count": len(rows),
        "market_distribution": market_distribution,
    }


def empty_portfolio_summary() -> dict:
    """Return the default summary shape for an empty portfolio."""
    return {
        "total_cost": 0,
        "total_market_value": 0,
        "total_pnl": 0,
        "total_pnl_percent": 0,
        "position_count": 0,
        "market_distribution": [],
    }
