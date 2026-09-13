"""Deterministic risk-plan calculations for professional reports."""

from __future__ import annotations

from typing import Any, Mapping


def _number(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _candidate_inputs(
    direction: str,
    current_price: float,
    trading_plan: Mapping[str, Any],
    indicators: Mapping[str, Any],
) -> dict[str, Any]:
    """Build watch-only geometry from attributable technical levels.

    Indicator trading levels are long-oriented.  For a bearish bias they are
    mirrored around the current price, matching the established fast-analysis
    fallback without inventing an actionable order.
    """
    candidate = dict(trading_plan)
    planned_entry = _number(candidate.get("entry_price") or candidate.get("entryPrice"))
    planned_stop = _number(candidate.get("stop_loss") or candidate.get("stopLoss"))
    planned_target = _number(candidate.get("take_profit") or candidate.get("takeProfit"))
    if (
        planned_entry is not None
        and planned_stop is not None
        and planned_target is not None
        and (
            (direction == "BUY" and planned_stop < planned_entry < planned_target)
            or (direction == "SELL" and planned_target < planned_entry < planned_stop)
        )
    ):
        return candidate
    candidate["entry_price"] = float(current_price)
    levels = indicators.get("trading_levels") or {}
    long_stop = _number(levels.get("suggested_stop_loss"))
    long_target = _number(levels.get("suggested_take_profit"))
    if long_stop is None or long_target is None:
        price_levels = indicators.get("levels") or {}
        long_stop = _number(price_levels.get("support"))
        long_target = _number(price_levels.get("resistance"))
    if long_stop is None or long_target is None:
        return candidate
    if direction == "SELL":
        candidate["stop_loss"] = 2 * current_price - long_stop
        candidate["take_profit"] = 2 * current_price - long_target
    else:
        candidate["stop_loss"] = long_stop
        candidate["take_profit"] = long_target
    return candidate


def _watch_only_setup(plan: Mapping[str, Any]) -> dict[str, Any] | None:
    if not plan.get("valid"):
        return None
    required = ("entry_price", "stop_loss", "take_profit", "stop_distance_pct", "gross_risk_reward", "net_risk_reward")
    if any(plan.get(key) is None for key in required):
        return None
    warnings = list(plan.get("warnings") or [])
    if "net_risk_reward_below_one" in warnings:
        warnings = [
            "candidate_net_risk_reward_below_one" if item == "net_risk_reward_below_one" else item
            for item in warnings
        ]
    return {
        "direction": plan["decision"],
        "status": "watch_only",
        "entry_price": plan["entry_price"],
        "stop_loss": plan["stop_loss"],
        "take_profit": plan["take_profit"],
        "stop_distance_pct": plan["stop_distance_pct"],
        "gross_risk_reward": plan["gross_risk_reward"],
        "net_risk_reward": plan["net_risk_reward"],
        "estimated_roundtrip_cost_bps": plan["estimated_roundtrip_cost_bps"],
        "source": "technical_levels",
        "warnings": warnings,
    }


def build_risk_plan(
    decision: str,
    current_price: float,
    trading_plan: Mapping[str, Any],
    *,
    data_quality_score: float,
    market: str,
    account_risk_budget_pct: float = 1.0,
    estimated_roundtrip_cost_bps: float | None = None,
    market_bias: str = "NEUTRAL",
    indicators: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a reproducible risk plan instead of accepting prose sizing.

    ``max_position_pct`` means the maximum fraction of account equity whose
    stop-distance loss fits the configured risk budget.  It is capped further
    by data quality and by a conservative product-type ceiling.
    """
    direction = str(decision or "HOLD").upper()
    if estimated_roundtrip_cost_bps is None:
        estimated_roundtrip_cost_bps = 20.0 if market == "Crypto" else 10.0
    entry = _number(trading_plan.get("entry_price") or trading_plan.get("entryPrice")) or float(current_price)
    stop = _number(trading_plan.get("stop_loss") or trading_plan.get("stopLoss"))
    target = _number(trading_plan.get("take_profit") or trading_plan.get("takeProfit"))

    if direction not in {"BUY", "SELL"} or not current_price or current_price <= 0:
        candidate_setup = None
        bias = str(market_bias or "NEUTRAL").upper()
        candidate_direction = "BUY" if bias == "BULLISH" else "SELL" if bias == "BEARISH" else None
        if candidate_direction and current_price and current_price > 0:
            candidate_plan = build_risk_plan(
                candidate_direction,
                current_price,
                _candidate_inputs(candidate_direction, current_price, trading_plan, indicators or {}),
                data_quality_score=data_quality_score,
                market=market,
                account_risk_budget_pct=account_risk_budget_pct,
                estimated_roundtrip_cost_bps=estimated_roundtrip_cost_bps,
            )
            candidate_setup = _watch_only_setup(candidate_plan)
        return {
            "decision": "HOLD",
            "entry_price": None,
            "stop_loss": None,
            "take_profit": None,
            "gross_risk_reward": None,
            "net_risk_reward": None,
            "risk_budget_pct": account_risk_budget_pct,
            "max_position_pct": 0.0,
            "recommended_position_pct": 0.0,
            "estimated_roundtrip_cost_bps": estimated_roundtrip_cost_bps,
            "valid": True,
            "warnings": ["no_directional_position"],
            "candidate_setup": candidate_setup,
        }

    valid = bool(
        stop is not None
        and target is not None
        and entry > 0
        and stop > 0
        and target > 0
        and (
            (direction == "BUY" and stop < entry < target)
            or (direction == "SELL" and target < entry < stop)
        )
    )
    if not valid:
        return {
            "decision": direction,
            "entry_price": entry,
            "stop_loss": stop,
            "take_profit": target,
            "gross_risk_reward": None,
            "net_risk_reward": None,
            "risk_budget_pct": account_risk_budget_pct,
            "max_position_pct": 0.0,
            "estimated_roundtrip_cost_bps": estimated_roundtrip_cost_bps,
            "valid": False,
            "warnings": ["invalid_price_geometry"],
        }

    risk = (entry - stop) if direction == "BUY" else (stop - entry)
    reward = (target - entry) if direction == "BUY" else (entry - target)
    cost = entry * float(estimated_roundtrip_cost_bps) / 10_000.0
    gross_rr = reward / risk if risk > 0 else 0.0
    net_reward = max(0.0, reward - cost)
    net_risk = risk + cost
    net_rr = net_reward / net_risk if net_risk > 0 else 0.0
    stop_distance_pct = risk / entry * 100.0 if entry > 0 else 0.0
    raw_position_pct = (
        float(account_risk_budget_pct) / stop_distance_pct * 100.0
        if stop_distance_pct > 0
        else 0.0
    )
    product_cap = 30.0 if market == "Crypto" else 50.0
    quality_cap = product_cap * max(0.0, min(1.0, float(data_quality_score) / 100.0))
    max_position_pct = max(0.0, min(raw_position_pct, quality_cap))
    model_size = _number(trading_plan.get("position_size_pct") or trading_plan.get("positionSizePct"))
    recommended_position_pct = min(max_position_pct, model_size) if model_size is not None else max_position_pct
    warnings: list[str] = []
    if net_rr < 1.0:
        warnings.append("net_risk_reward_below_one")
    if data_quality_score < 70:
        warnings.append("position_reduced_for_data_quality")
    if market == "Crypto":
        warnings.extend(["funding_cost_not_guaranteed", "liquidation_and_venue_risk"])
    else:
        warnings.append("gap_risk_not_capped_by_stop")

    return {
        "decision": direction,
        "entry_price": round(entry, 8),
        "stop_loss": round(stop, 8),
        "take_profit": round(target, 8),
        "stop_distance_pct": round(stop_distance_pct, 4),
        "gross_risk_reward": round(gross_rr, 4),
        "net_risk_reward": round(net_rr, 4),
        "risk_budget_pct": round(float(account_risk_budget_pct), 4),
        "max_position_pct": round(max_position_pct, 4),
        "recommended_position_pct": round(recommended_position_pct, 4),
        "estimated_roundtrip_cost_bps": round(float(estimated_roundtrip_cost_bps), 2),
        "valid": True,
        "warnings": warnings,
    }


__all__ = ["build_risk_plan"]
