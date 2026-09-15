/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - TradingView Alert Outcome Guidance
 */

function getAlertOperator(direction, orderType = "", triggerRule = "") {
  const normalizedOrder = String(orderType || "").toUpperCase();
  const rule = String(triggerRule || "").toLowerCase();
  if (
    /cross(?:es|ing)?\s+down|break(?:s)?\s+below|close(?:s)?\s+below/.test(rule)
  )
    return "Crossing down";
  if (
    /cross(?:es|ing)?\s+up|break(?:s)?\s+above|close(?:s)?\s+above|reclaim/.test(
      rule,
    )
  )
    return "Crossing up";
  if (normalizedOrder === "BUY_LIMIT") return "Crossing down";
  if (normalizedOrder === "SELL_LIMIT") return "Crossing up";
  return String(direction || "").toUpperCase() === "SHORT"
    ? "Crossing down"
    : "Crossing up";
}

function buildTradingViewAlertPlan({
  signal,
  watchCondition,
  symbol,
  timeframe,
}) {
  const source = signal || watchCondition;
  if (!source) return null;
  const level = normalizePanelText(
    signal?.entry || getWatchAlertLevel(watchCondition),
  );
  if (!level) return null;
  const direction = String(source.direction || "WATCH").toUpperCase();
  const triggerRule = signal?.triggerRule || watchCondition?.trigger || "";
  const operator = getAlertOperator(direction, signal?.orderType, triggerRule);
  const requiresClose = /close|bar close|candle close|hold|retest/i.test(
    triggerRule,
  );
  const name = `ChartMentor ${symbol} ${direction} ${level}`.trim();
  return {
    level,
    operator,
    frequency: requiresClose ? "Once per bar close" : "Only once",
    name,
    message: `${name}${timeframe ? ` on ${timeframe}` : ""}. Re-open ChartMentor and confirm the setup before entry.`,
  };
}

function showTradingViewAlertGuidance(container, result, alertPlan) {
  if (!container || !alertPlan) return;

  container.querySelector(".tradingview-alert-guidance")?.remove();

  const guidance = document.createElement("div");
  guidance.className = `tradingview-alert-guidance${result.filled ? " autofilled" : " fallback"}`;

  const copy = document.createElement("div");
  copy.className = "tradingview-alert-guidance-copy";

  const title = document.createElement("strong");
  const instructions = document.createElement("span");
  if (result.opened && result.filled) {
    title.textContent = "Alert price filled";
    instructions.textContent = `Confirm ${alertPlan.operator} · ${alertPlan.frequency}, then create the alert.`;
  } else if (result.opened && result.copied) {
    title.textContent = "Autofill unavailable";
    instructions.textContent = `Price ${alertPlan.level} is copied. Paste it into TradingView's Value field, then select ${alertPlan.operator} · ${alertPlan.frequency}.`;
  } else if (result.copied) {
    title.textContent = "TradingView alert did not open";
    instructions.textContent = `Price ${alertPlan.level} is copied. Open Create alert, paste it into the Value field, then select ${alertPlan.operator} · ${alertPlan.frequency}.`;
  } else {
    title.textContent = "Set the alert manually";
    instructions.textContent = `Use price ${alertPlan.level} with ${alertPlan.operator} · ${alertPlan.frequency}.`;
  }
  copy.append(title, instructions);

  const controls = document.createElement("div");
  controls.className = "tradingview-alert-guidance-controls";
  const copyAgain = document.createElement("button");
  copyAgain.type = "button";
  copyAgain.className = "tradingview-alert-guidance-action";
  copyAgain.textContent = "Copy price again";
  copyAgain.addEventListener("click", async (event) => {
    event.stopPropagation();
    const copied = await copyTextToClipboard(alertPlan.level);
    copyAgain.textContent = copied ? "Copied" : "Copy failed";
    window.setTimeout(() => {
      copyAgain.textContent = "Copy price again";
    }, 1400);
  });

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "tradingview-alert-guidance-action";
  dismiss.textContent = "Got it";
  dismiss.addEventListener("click", (event) => {
    event.stopPropagation();
    guidance.remove();
  });
  controls.append(copyAgain, dismiss);

  guidance.append(copy, controls);
  container.appendChild(guidance);
}
