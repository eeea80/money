from app.services.analysis_memory import _build_regime_performance
from app.services.fast_analysis import FastAnalysisService


def _service():
    service = FastAnalysisService()
    service._get_ai_calibration = lambda market="Crypto": {}
    return service


def test_valid_llm_levels_have_priority_and_final_rr_is_recalculated():
    result = _service()._finalize_trading_plan_for_decision(
        {
            "decision": "BUY",
            "entry_price": 100,
            "stop_loss": 92,
            "take_profit": 104,
        },
        100,
        {"trading_levels": {"suggested_stop_loss": 98, "suggested_take_profit": 109}},
    )

    assert result["stop_loss"] == 92
    assert result["take_profit"] == 104
    assert result["trading_plan_source"] == "llm"
    assert result["risk_reward_ratio"] == 0.5
    assert result["rr_warning"]["code"] == "risk_reward_below_one"


def test_sell_rr_uses_short_direction_without_moving_target():
    result = _service()._finalize_trading_plan_for_decision(
        {
            "decision": "SELL",
            "entry_price": 100,
            "stop_loss": 108,
            "take_profit": 96,
        },
        100,
        {},
    )

    assert result["stop_loss"] == 108
    assert result["take_profit"] == 96
    assert result["risk_reward_ratio"] == 0.5
    assert result["rr_warning"] is not None


def test_technical_levels_are_only_used_when_llm_geometry_is_invalid():
    result = _service()._finalize_trading_plan_for_decision(
        {
            "decision": "BUY",
            "entry_price": 100,
            "stop_loss": 105,
            "take_profit": 95,
        },
        100,
        {"trading_levels": {"suggested_stop_loss": 96, "suggested_take_profit": 108}},
    )

    assert result["stop_loss"] == 96
    assert result["take_profit"] == 108
    assert result["trading_plan_source"] == "technical_fallback"
    assert result["risk_reward_ratio"] == 2
    assert result["rr_warning"] is None


def test_full_validation_pipeline_uses_technical_levels_before_safety_defaults():
    result = _service()._validate_and_constrain(
        {
            "decision": "BUY",
            "confidence": 80,
            "technical_score": 70,
            "fundamental_score": 60,
            "sentiment_score": 60,
            "entry_price": 100,
            "stop_loss": 105,
            "take_profit": 95,
        },
        100,
        {
            "trading_levels": {
                "suggested_stop_loss": 98,
                "suggested_take_profit": 104,
            }
        },
    )

    assert result["stop_loss"] == 98
    assert result["take_profit"] == 104
    assert result["trading_plan_source"] == "technical_fallback"
    assert result["risk_reward_ratio"] == 2


def test_overbought_strong_uptrend_does_not_short_without_reversal_confirmation():
    analysis = {
        "decision": "SELL",
        "confidence": 82,
        "summary": "Short because RSI is overbought",
        "objective_scores_by_timeframe": {
            "4H": {"decision": "BUY"},
            "1D": {"decision": "BUY"},
        },
    }
    indicators = {
        "rsi": {"value": 76},
        "macd": {"signal": "bullish"},
        "moving_averages": {"trend": "strong_uptrend", "ma20": 95},
        "current_price": 100,
        "price_position": 88,
        "volume_ratio": 1.0,
    }

    result = _service()._validate_decision_against_indicators(analysis, indicators, 82)

    assert result["decision"] == "HOLD"
    assert result["decision_guard"] == "countertrend_sell_unconfirmed"


def test_confirmed_countertrend_sell_is_still_allowed():
    analysis = {
        "decision": "SELL",
        "confidence": 82,
        "objective_scores_by_timeframe": {
            "4H": {"decision": "SELL"},
            "1D": {"decision": "SELL"},
        },
    }
    indicators = {
        "rsi": {"value": 76},
        "macd": {"signal": "bearish"},
        "moving_averages": {"trend": "strong_uptrend", "ma20": 95},
        "current_price": 100,
        "price_position": 75,
        "volume_ratio": 1.2,
    }

    result = _service()._validate_decision_against_indicators(analysis, indicators, 82)

    assert result["decision"] == "SELL"


def test_regime_monitor_groups_decisions_and_realized_outcomes():
    rows = [
        {
            "decision": "SELL",
            "actual_return_pct": -1.0,
            "was_correct": False,
            "raw_result": {"consensus": {"risk_context": {"trend": "strong_uptrend"}}},
        },
        {
            "decision": "BUY",
            "actual_return_pct": 2.0,
            "was_correct": True,
            "raw_result": {"consensus": {"risk_context": {"trend": "strong_uptrend"}}},
        },
    ]

    grouped = _build_regime_performance(rows)

    assert grouped == [{
        "market_regime": "strong_uptrend",
        "total": 2,
        "decision_distribution": {"buy": 1, "sell": 1, "hold": 0},
        "accuracy_pct": 50.0,
        "avg_return_pct": 0.5,
    }]


def test_pdf_explicitly_renders_low_rr_warning():
    pdf = build_ai_report_pdf({
        "market": "Crypto",
        "symbol": "BTC/USDT",
        "decision": "BUY",
        "confidence": 70,
        "trading_plan": {
            "entry_price": 100,
            "stop_loss": 92,
            "take_profit": 104,
            "risk_reward_ratio": 0.5,
            "rr_warning": {"code": "risk_reward_below_one"},
        },
    })

    text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(pdf)).pages)

    assert "Risk/reward warning" in text
    assert "target was not stretched" in text
from io import BytesIO

from pypdf import PdfReader

from app.services.ai_report_pdf import build_ai_report_pdf
