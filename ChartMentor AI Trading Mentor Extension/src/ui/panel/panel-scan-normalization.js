function normalizeSignalConfidence(value) {
  let confidence = parseFloat(value);
  if (!Number.isFinite(confidence)) return 0;
  if (confidence > 0 && confidence <= 1) confidence *= 100;
  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function normalizeOrderTypeForPanel(value, direction = "LONG") {
  const normalized = normalizeSignalValue(value, "")
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (
    ["MARKET", "BUY_STOP", "SELL_STOP", "BUY_LIMIT", "SELL_LIMIT"].includes(
      normalized,
    )
  ) {
    return normalized;
  }
  return direction === "SHORT" ? "SELL_STOP" : "BUY_STOP";
}

function getSignalOrderLabel(signal) {
  return String(
    signal?.orderType ||
      normalizeOrderTypeForPanel(signal?.order_type, signal?.direction),
  ).replace(/_/g, " ");
}

function normalizeSignalForPanel(signal, index = 0) {
  if (!signal || typeof signal !== "object") return null;

  const rawDirection = normalizeSignalValue(signal.direction, "").toUpperCase();
  const direction =
    rawDirection === "BUY"
      ? "LONG"
      : rawDirection === "SELL"
        ? "SHORT"
        : rawDirection;
  if (direction !== "LONG" && direction !== "SHORT") return null;

  return {
    ...signal,
    id: normalizeSignalValue(signal.id, `signal-${index}`),
    direction,
    orderType: normalizeOrderTypeForPanel(
      signal.orderType || signal.order_type,
      direction,
    ),
    symbol: normalizeSignalValue(
      signal.symbol,
      state.currentSymbol || "Unknown",
    ),
    timeframe: normalizeSignalValue(
      signal.timeframe,
      state.currentTimeframe || "Unknown",
    ),
    entry: normalizeSignalValue(
      signal.entry || signal.trigger || signal.entryLevel || signal.level,
    ),
    stopLoss: normalizeSignalValue(
      signal.stopLoss || signal.stop_loss || signal.invalidation,
    ),
    takeProfit: normalizeSignalValue(
      signal.takeProfit || signal.take_profit || signal.target,
    ),
    takeProfit2: normalizeSignalValue(
      signal.takeProfit2 || signal.take_profit_2 || signal.tp2,
      "",
    ),
    takeProfit3: normalizeSignalValue(
      signal.takeProfit3 || signal.take_profit_3 || signal.tp3,
      "",
    ),
    riskReward: normalizeSignalValue(signal.riskReward || signal.risk_reward),
    confidence: normalizeSignalConfidence(signal.confidence),
    triggerRule: normalizeSignalValue(
      signal.triggerRule || signal.trigger_rule,
      "",
    ),
    cancelRule: normalizeSignalValue(
      signal.cancelRule || signal.cancel_rule,
      "",
    ),
    managementRule: normalizeSignalValue(
      signal.managementRule || signal.management_rule,
      "",
    ),
  };
}

function getRenderableSignals(signals) {
  if (!Array.isArray(signals)) return [];
  return signals
    .map((signal, index) => normalizeSignalForPanel(signal, index))
    .filter(
      (signal) =>
        signal && signal.confidence >= MIN_STRUCTURED_SIGNAL_CONFIDENCE,
    );
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn("ChartMentor: Clipboard API unavailable", error);
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch (error) {
    console.error("ChartMentor: Clipboard fallback failed", error);
    return false;
  }
}

async function copyAndOpenTradingViewAlert(text) {
  let copied = false;
  let opened = false;
  let filled = false;
  try {
    copied = await copyTextToClipboard(text);
  } catch (error) {
    console.warn("ChartMentor: Alert text copy failed", error);
  }
  try {
    const alertResult = await requestTradingViewAlertDialog(text);
    opened = alertResult.opened;
    filled = alertResult.filled;
  } catch (error) {
    console.warn("ChartMentor: TradingView alert open failed", error);
  }
  return { copied, opened, filled };
}

function getAnalysisFocus(analysisData) {
  const focus = String(
    analysisData?.analysisFocus || analysisData?.analysis_focus || "",
  );
  return focus === "position_review" || focus === "trade_validation"
    ? focus
    : "signal";
}
