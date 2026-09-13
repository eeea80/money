"""Final trading-plan normalization for Fast Analysis."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.services.fast_analysis_formatters import safe_float_price


def trading_plan_risk_fields(analysis: Dict[str, Any]) -> Dict[str, Any]:
    """Return the snake/camel-case final risk contract used by API clients."""
    return {
        "risk_reward_ratio": analysis.get("risk_reward_ratio"),
        "rr_warning": analysis.get("rr_warning"),
        "risk_reward_entry_price": analysis.get("risk_reward_entry_price"),
        "source": analysis.get("trading_plan_source"),
        "riskRewardRatio": analysis.get("risk_reward_ratio"),
        "rrWarning": analysis.get("rr_warning"),
    }


def finalize_trading_plan(
    analysis: Dict[str, Any],
    current_price: float,
    indicators: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Preserve valid LLM levels, apply fallbacks, then recalculate final R/R."""
    if not current_price or current_price <= 0:
        return analysis
    indicators = indicators or {}
    decision = str(analysis.get("decision", "HOLD")).upper()
    if decision not in ("BUY", "SELL"):
        analysis["risk_reward_ratio"] = None
        analysis["rr_warning"] = None
        return analysis

    min_price = current_price * 0.90
    max_price = current_price * 1.10
    eps = max(abs(current_price) * 1e-6, 1e-8)

    def valid_geometry(sl: Optional[float], tp: Optional[float]) -> bool:
        if sl is None or tp is None:
            return False
        if decision == "SELL":
            return min_price <= tp < current_price - eps < current_price + eps < sl <= max_price
        return min_price <= sl < current_price - eps < current_price + eps < tp <= max_price

    llm_sl = safe_float_price(analysis.get("stop_loss"))
    llm_tp = safe_float_price(analysis.get("take_profit"))
    if valid_geometry(llm_sl, llm_tp):
        analysis["stop_loss"] = round(float(llm_sl), 6)
        analysis["take_profit"] = round(float(llm_tp), 6)
        analysis["trading_plan_source"] = "llm"
    else:
        levels = indicators.get("trading_levels") or {}
        sl_long = safe_float_price(levels.get("suggested_stop_loss"))
        tp_long = safe_float_price(levels.get("suggested_take_profit"))
        long_ok = (
            sl_long is not None
            and tp_long is not None
            and min_price <= sl_long < current_price - eps
            and current_price + eps < tp_long <= max_price
        )
        indicator_sl: Optional[float] = None
        indicator_tp: Optional[float] = None
        if long_ok and decision == "BUY":
            indicator_sl, indicator_tp = float(sl_long), float(tp_long)
        elif long_ok and decision == "SELL":
            indicator_sl = min(max(2 * current_price - float(sl_long), current_price + eps), max_price)
            indicator_tp = max(min(2 * current_price - float(tp_long), current_price - eps), min_price)

        if valid_geometry(indicator_sl, indicator_tp):
            analysis["stop_loss"] = round(float(indicator_sl), 6)
            analysis["take_profit"] = round(float(indicator_tp), 6)
            analysis["trading_plan_source"] = "technical_fallback"
        elif decision == "SELL":
            analysis["stop_loss"] = round(min(max_price, current_price * 1.05), 6)
            analysis["take_profit"] = round(max(min_price, current_price * 0.95), 6)
            analysis["trading_plan_source"] = "safety_fallback"
        else:
            analysis["stop_loss"] = round(max(min_price, current_price * 0.95), 6)
            analysis["take_profit"] = round(min(max_price, current_price * 1.05), 6)
            analysis["trading_plan_source"] = "safety_fallback"

    sl_final = safe_float_price(analysis.get("stop_loss"), current_price)
    tp_final = safe_float_price(analysis.get("take_profit"), current_price)
    if sl_final is None or tp_final is None:
        return analysis
    entry = safe_float_price(analysis.get("entry_price"), current_price) or current_price
    if decision == "SELL" and not (tp_final < entry < sl_final):
        entry = current_price
    elif decision == "BUY" and not (sl_final < entry < tp_final):
        entry = current_price

    if decision == "SELL":
        risk, reward = sl_final - entry, entry - tp_final
    else:
        risk, reward = entry - sl_final, tp_final - entry
    ratio = round(reward / risk, 4) if risk > 0 and reward >= 0 else 0.0
    analysis["risk_reward_ratio"] = ratio
    analysis["risk_reward_entry_price"] = round(entry, 6)
    analysis["rr_warning"] = (
        {
            "code": "risk_reward_below_one",
            "severity": "warning",
            "threshold": 1.0,
            "message": "Potential reward is lower than the planned risk.",
        }
        if ratio < 1.0
        else None
    )
    return analysis
