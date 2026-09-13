import json
import re
from typing import Any, Dict, Optional

from app.utils.logger import get_logger

logger = get_logger(__name__)


def _extract_json_object(raw: str) -> Optional[Dict[str, Any]]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*", "", text).strip()
        if text.endswith("```"):
            text = text[:-3].strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None


def _num(value: Any, default: float, min_value: float | None = None, max_value: float | None = None) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = float(default)
    if min_value is not None:
        number = max(float(min_value), number)
    if max_value is not None:
        number = min(float(max_value), number)
    return number


def _int(value: Any, default: int, min_value: int | None = None, max_value: int | None = None) -> int:
    return int(round(_num(value, default, min_value, max_value)))


def _bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return default if value is None else bool(value)


def _ratio(value: Any, default: float) -> float:
    number = _num(value, default, 0.001, 100)
    return number / 100 if number > 1 else number


def _fetch_market_context(prompt: str) -> tuple[str, Optional[str], str]:
    detected_market = ""
    detected_symbol: Optional[str] = None
    market_data_section = ""

    try:
        from app.services.ai_bot_symbol_detect import detect_market_and_symbol

        hit = detect_market_and_symbol(prompt)
        if hit:
            detected_market, detected_symbol = hit

        if not detected_symbol:
            return detected_market, detected_symbol, market_data_section

        from app.services.kline import KlineService

        service = KlineService()
        candidate_frames = ("4h", "1d", "1h") if detected_market == "Crypto" else ("1d", "4h", "1h")
        klines = []
        timeframe = ""
        for frame in candidate_frames:
            try:
                klines = service.get_kline(
                    market=detected_market,
                    symbol=detected_symbol,
                    timeframe=frame,
                    limit=50 if frame in ("4h", "1h") else 30,
                ) or []
            except Exception as exc:
                logger.warning(
                    "[AI Bot] kline fetch failed market=%s symbol=%s timeframe=%s: %s",
                    detected_market,
                    detected_symbol,
                    frame,
                    exc,
                )
                klines = []
            if klines and len(klines) >= 5:
                timeframe = frame
                break

        if not klines or len(klines) < 5:
            market_data_section = (
                f"\n\nNOTE: Symbol {detected_symbol} ({detected_market}) was identified "
                "but no recent K-line data was available. Recommend conservative defaults "
                "and tell the user to manually verify the upper/lower bounds.\n"
            )
            logger.warning("[AI Bot] No klines returned for market=%s symbol=%s", detected_market, detected_symbol)
            return detected_market, detected_symbol, market_data_section

        closes = [float(k.get("close", 0)) for k in klines if k.get("close")]
        highs = [float(k.get("high", 0)) for k in klines if k.get("high")]
        lows = [float(k.get("low", 0)) for k in klines if k.get("low")]
        volumes = [float(k.get("volume", 0)) for k in klines if k.get("volume")]
        current_price = closes[-1] if closes else 0
        high_recent = max(highs) if highs else 0
        low_recent = min(lows) if lows else 0
        avg_price = sum(closes) / len(closes) if closes else 0
        avg_volume = sum(volumes) / len(volumes) if volumes else 0
        price_change_pct = ((closes[-1] - closes[0]) / closes[0] * 100) if closes and closes[0] else 0
        sma5 = sum(closes[-5:]) / min(5, len(closes[-5:])) if len(closes) >= 5 else avg_price
        sma20 = sum(closes[-20:]) / min(20, len(closes[-20:])) if len(closes) >= 20 else avg_price
        volatility = ((high_recent - low_recent) / avg_price * 100) if avg_price else 0
        volume_line = f"Avg Volume: {avg_volume:.2f}\n" if avg_volume > 0 else ""

        market_data_section = (
            f"\n\n=== REAL-TIME MARKET DATA for {detected_symbol} "
            f"(market={detected_market}, last {len(klines)} candles, {timeframe} timeframe) ===\n"
            f"Current Price: {current_price}\n"
            f"Period High: {high_recent}\n"
            f"Period Low: {low_recent}\n"
            f"Price Change: {price_change_pct:+.2f}%\n"
            f"Average Price: {avg_price:.4f}\n"
            f"SMA(5): {sma5:.4f}\n"
            f"SMA(20): {sma20:.4f}\n"
            f"Trend: {'Bullish (SMA5 > SMA20)' if sma5 > sma20 else 'Bearish (SMA5 < SMA20)'}\n"
            f"Volatility (range/avg): {volatility:.2f}%\n"
            f"{volume_line}"
            f"Recent 10 closes: {[round(c, 4) for c in closes[-10:]]}\n"
            "=== END MARKET DATA ===\n\n"
            "IMPORTANT: Use the REAL market data above to set realistic parameters. "
            "For grid bots, set upperPrice/lowerPrice based on the actual Period High/Low and current volatility. "
            "For trend bots, consider the current trend direction. "
            "For DCA bots, consider the price level and change percentage."
        )
    except Exception as exc:
        logger.warning("[AI Bot] Failed to fetch market data: %s", exc)

    return detected_market, detected_symbol, market_data_section


def _bot_recommend_system_prompt(detected_market: str, allowed_bots: list[str]) -> str:
    from app.services.broker_market_policy import BOT_TYPE_MARKETS

    market_constraint = (
        f"\nIMPORTANT MARKET CONSTRAINT: The detected market is '{detected_market or 'Crypto'}'. "
        f"Allowed bot types for this market are: {allowed_bots}. Do NOT recommend a botType outside this list.\n"
        if detected_market else ""
    )
    quote_label = "USD" if detected_market in ("USStock", "Forex") else "USDT"

    return (
        "You are an expert quantitative trading advisor. The user wants to create an automated trading bot.\n"
        "Based on their description AND the real-time market data provided, recommend one of the four bot types and provide optimal parameters.\n\n"
        "Available bot types and their parameter schemas. Use these exact frontend keys:\n"
        "1. grid - Grid Trading: {upperPrice, lowerPrice, gridCount: int(5-100), gridMode: 'arithmetic'|'geometric', "
        "gridDirection: 'long'|'short'|'neutral', initialPositionPct: number(0-100), "
        "boundaryAction: 'pause'|'stop_loss'|'hold', adaptiveBounds: boolean, adaptiveAtrMult: number(0.5-5), "
        "waterfallProtection: boolean, waterfallDropPct: decimal ratio(0.005-0.20; example 0.03 means 3%)}\n"
        "2. martingale - Martingale: {multiplier: number(1.1-3.0), maxLayers: int(2-10), "
        "priceDropPct: number(1-20), takeProfitPct: number(0.2-50), stopLossPct: number(1-50), "
        "direction: 'long'|'short', trailingTpEnabled: boolean, trailingTpCallbackPct: number(0.05-50), "
        "waterfallProtection: boolean, waterfallDropPct: decimal ratio(0.005-0.20; example 0.04 means 4%)}\n"
        "3. trend - Trend Following: {maPeriod: int(5-200), maType: 'SMA'|'EMA', confirmBars: int(1-5), "
        "positionPct: number(10-100), direction: 'long'|'short'|'both', trailingTpEnabled: boolean, "
        "trailingTpActivationPct: number(0.2-100), trailingTpCallbackPct: number(0.05-50)}\n"
        "4. dca - DCA (Dollar-Cost Averaging): {frequency: 'every_bar'|'hourly'|'4h'|'daily'|'weekly'|'biweekly'|'monthly', "
        "dipBuyEnabled: boolean, dipThreshold: number(1-30)}\n\n"
        f"Bot type x market matrix: {dict(BOT_TYPE_MARKETS)}\n"
        f"{market_constraint}"
        "Also suggest base config:\n"
        f"- marketCategory: 'Crypto'|'USStock'|'Forex' (must match the detected market: '{detected_market or 'Crypto'}')\n"
        "- symbol: string\n"
        "- timeframe: '1m'|'5m'|'15m'|'1h'|'4h'|'1d'\n"
        "- marketType: 'swap'|'spot' (USStock and Forex are always 'spot')\n"
        "- leverage: int(1-125, only for swap; ignored on spot/USStock/Forex)\n"
        f"- initialCapital: number (in {quote_label})\n\n"
        "Risk config:\n"
        "- stopLossPct: number(0-100), stored as a 0-100 UI percent\n"
        "- takeProfitPct: number(0-1000), stored as a 0-100 UI percent\n"
        "- maxPosition: number\n\n"
        "Percent convention: fields ending in Pct are 0-100 UI percentages, except waterfallDropPct, which is a 0-1 decimal ratio.\n"
        "Do NOT set amountPerGrid, initialAmount, amountEach, totalBudget, or a real initialCapital. The user enters capital.\n"
        "Return ONLY a single valid JSON object with botType, botName, reason, baseConfig, strategyParams, and riskConfig."
    )


def _normalize_recommendation(result: Dict[str, Any], detected_market: str, detected_symbol: Optional[str]) -> Dict[str, Any]:
    from app.services.broker_market_policy import allowed_bot_types

    valid_types = ("grid", "martingale", "trend", "dca")
    if result.get("botType") not in valid_types:
        result["botType"] = "grid"

    if detected_market:
        allowed_for_market = allowed_bot_types(detected_market)
        if allowed_for_market and result.get("botType") not in allowed_for_market:
            result["botType"] = "dca" if "dca" in allowed_for_market else sorted(allowed_for_market)[0]

    base_cfg = result.get("baseConfig") if isinstance(result.get("baseConfig"), dict) else {}
    if detected_market:
        base_cfg["marketCategory"] = detected_market
    elif not base_cfg.get("marketCategory"):
        base_cfg["marketCategory"] = "Crypto"
    if base_cfg.get("marketCategory") in ("USStock", "Forex"):
        base_cfg["marketType"] = "spot"
        base_cfg["leverage"] = 1
    if detected_symbol:
        base_cfg["symbol"] = detected_symbol
    result["baseConfig"] = base_cfg

    params = result.get("strategyParams") if isinstance(result.get("strategyParams"), dict) else {}
    risk_cfg = result.get("riskConfig") if isinstance(result.get("riskConfig"), dict) else {}
    bot_type = result.get("botType")
    market_type = base_cfg.get("marketType") or "spot"
    force_long = market_type == "spot" or base_cfg.get("marketCategory") in ("USStock", "Forex")

    if bot_type == "grid":
        params.pop("amountPerGrid", None)
        params.update({
            "upperPrice": _num(params.get("upperPrice"), 0, 0),
            "lowerPrice": _num(params.get("lowerPrice"), 0, 0),
            "gridCount": _int(params.get("gridCount"), 10, 5, 100),
            "gridMode": params.get("gridMode") if params.get("gridMode") in ("arithmetic", "geometric") else "arithmetic",
            "gridDirection": "long" if force_long else (params.get("gridDirection") if params.get("gridDirection") in ("long", "short", "neutral") else "neutral"),
            "initialPositionPct": _num(params.get("initialPositionPct"), 0, 0, 100),
            "boundaryAction": params.get("boundaryAction") if params.get("boundaryAction") in ("pause", "stop_loss", "hold") else "pause",
            "adaptiveBounds": _bool(params.get("adaptiveBounds"), True),
            "adaptiveAtrMult": _num(params.get("adaptiveAtrMult"), 2, 0.5, 5),
            "waterfallProtection": _bool(params.get("waterfallProtection"), True),
            "waterfallDropPct": _ratio(params.get("waterfallDropPct"), 0.03),
        })
    elif bot_type == "martingale":
        params.pop("initialAmount", None)
        params.update({
            "multiplier": _num(params.get("multiplier"), 2, 1.1, 3),
            "maxLayers": _int(params.get("maxLayers"), 5, 2, 10),
            "priceDropPct": _num(params.get("priceDropPct"), 3, 1, 20),
            "takeProfitPct": _num(params.get("takeProfitPct") or risk_cfg.get("takeProfitPct"), 2, 0.2, 50),
            "stopLossPct": _num(params.get("stopLossPct") or risk_cfg.get("stopLossPct"), 12, 1, 50),
            "direction": "long" if force_long else (params.get("direction") if params.get("direction") in ("long", "short") else "long"),
            "trailingTpEnabled": _bool(params.get("trailingTpEnabled"), False),
            "trailingTpCallbackPct": _num(params.get("trailingTpCallbackPct"), 0.8, 0.05, 50),
            "waterfallProtection": _bool(params.get("waterfallProtection"), True),
            "waterfallDropPct": _ratio(params.get("waterfallDropPct"), 0.04),
        })
    elif bot_type == "trend":
        params.update({
            "maPeriod": _int(params.get("maPeriod"), 20, 5, 200),
            "maType": params.get("maType") if params.get("maType") in ("SMA", "EMA") else "EMA",
            "confirmBars": _int(params.get("confirmBars"), 2, 1, 5),
            "positionPct": _num(params.get("positionPct"), 50, 10, 100),
            "direction": "long" if force_long else (params.get("direction") if params.get("direction") in ("long", "short", "both") else "both"),
            "trailingTpEnabled": _bool(params.get("trailingTpEnabled"), False),
            "trailingTpActivationPct": _num(params.get("trailingTpActivationPct"), 5, 0.2, 100),
            "trailingTpCallbackPct": _num(params.get("trailingTpCallbackPct"), 1, 0.05, 50),
        })
    elif bot_type == "dca":
        params.pop("amountEach", None)
        params.pop("totalBudget", None)
        frequency = str(params.get("frequency") or "").strip().lower()
        allowed = {"every_bar", "hourly", "4h", "daily", "weekly", "biweekly", "monthly"}
        params.update({
            "frequency": frequency if frequency in allowed else "daily",
            "dipBuyEnabled": _bool(params.get("dipBuyEnabled"), False),
            "dipThreshold": _num(params.get("dipThreshold"), 5, 1, 30),
        })

    risk_cfg["stopLossPct"] = _num(risk_cfg.get("stopLossPct"), 10, 0, 100)
    risk_cfg["takeProfitPct"] = _num(risk_cfg.get("takeProfitPct"), 20, 0, 1000)
    risk_cfg["maxPosition"] = _num(risk_cfg.get("maxPosition"), 0, 0)
    result["strategyParams"] = params
    result["riskConfig"] = risk_cfg
    return result


def recommend_bot_strategy(llm: Any, prompt: str) -> Dict[str, Any]:
    from app.services.broker_market_policy import allowed_bot_types

    detected_market, detected_symbol, market_data_section = _fetch_market_context(prompt)
    allowed_bots = sorted(allowed_bot_types(detected_market)) if detected_market else []
    if not allowed_bots:
        allowed_bots = ["grid", "martingale", "trend", "dca"]

    content = llm.call_llm_api(
        messages=[
            {"role": "system", "content": _bot_recommend_system_prompt(detected_market, allowed_bots)},
            {"role": "user", "content": f"User request:\n{prompt.strip()}{market_data_section}"},
        ],
        model=llm.get_code_generation_model(),
        temperature=0.4,
        use_json_mode=False,
    )
    result = _extract_json_object(content or "")
    if not isinstance(result, dict) or "botType" not in result:
        raise ValueError("AI did not return valid bot recommendation")
    return _normalize_recommendation(result, detected_market, detected_symbol)
