from typing import Any, Dict, Optional


def safe_float_price(value: Any, default: Optional[float] = None) -> Optional[float]:
    """Coerce LLM/string prices to float; invalid values return default."""
    if value is None:
        return default
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (value != value):
            return default
        return float(value)
    try:
        text = str(value).strip().replace(",", "")
        if not text:
            return default
        return float(text)
    except (TypeError, ValueError):
        return default


def build_trend_outlook_summary(trend_outlook: Dict[str, Any], language: str) -> str:
    """Build the legacy API summary string for a multi-horizon trend outlook."""
    if not trend_outlook:
        return ""
    is_zh = str(language or "").lower().startswith("zh")

    def label(trend: str, score: Any = None) -> str:
        normalized = str(trend or "HOLD").upper()
        try:
            numeric_score = float(score)
        except (TypeError, ValueError):
            numeric_score = 0.0
        if is_zh:
            if normalized == "HOLD" and numeric_score >= 10:
                return "轻微利多·观望"
            if normalized == "HOLD" and numeric_score <= -10:
                return "轻微利空·观望"
            return {"BUY": "看多", "SELL": "看空", "HOLD": "震荡/中性"}.get(normalized, "震荡/中性")
        if normalized == "HOLD" and numeric_score >= 10:
            return "mildly bullish · wait"
        if normalized == "HOLD" and numeric_score <= -10:
            return "mildly bearish · wait"
        return {"BUY": "bullish", "SELL": "bearish", "HOLD": "neutral / range"}.get(
            normalized,
            "neutral / range",
        )

    n24 = trend_outlook.get("next_24h") or {}
    d3 = trend_outlook.get("next_3d") or {}
    w1 = trend_outlook.get("next_1w") or {}
    m1 = trend_outlook.get("next_1m") or {}

    if is_zh:
        return "；".join(
            [
                f"约24小时：{label(n24.get('trend'), n24.get('score'))}（强度 {n24.get('strength', 'neutral')}）",
                f"约3天：{label(d3.get('trend'), d3.get('score'))}（强度 {d3.get('strength', 'neutral')}）",
                f"约1周：{label(w1.get('trend'), w1.get('score'))}（强度 {w1.get('strength', 'neutral')}）",
                f"约1月：{label(m1.get('trend'), m1.get('score'))}（强度 {m1.get('strength', 'neutral')}）",
            ]
        )
    return " | ".join(
        [
            f"~24h: {label(n24.get('trend'), n24.get('score'))} ({n24.get('strength', 'neutral')})",
            f"~3d: {label(d3.get('trend'), d3.get('score'))} ({d3.get('strength', 'neutral')})",
            f"~1w: {label(w1.get('trend'), w1.get('score'))} ({w1.get('strength', 'neutral')})",
            f"~1m: {label(m1.get('trend'), m1.get('score'))} ({m1.get('strength', 'neutral')})",
        ]
    )
