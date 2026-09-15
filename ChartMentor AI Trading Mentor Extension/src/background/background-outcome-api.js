/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Outcome loop backend bridge
 *
 * Posts the local one-tap "How did it finish?" answer to
 * submit-review-outcome (text only, no screenshot, no AI/vision call).
 */

const OUTCOME_TRADE_RESULTS = new Set([
  "win",
  "loss",
  "breakeven",
  "unclear",
  "still_open",
  "not_triggered",
]);

async function submitReviewOutcome(outcomeData = {}) {
  const tradeResult = String(outcomeData.tradeResult || "");
  if (!OUTCOME_TRADE_RESULTS.has(tradeResult)) {
    return { success: false, error: "Invalid trade result" };
  }
  const payload = {
    tradeResult,
    analysisId:
      typeof outcomeData.analysisId === "string"
        ? outcomeData.analysisId.slice(0, 64)
        : null,
    planDirection:
      outcomeData.planDirection === "LONG" || outcomeData.planDirection === "SHORT"
        ? outcomeData.planDirection
        : null,
    symbol:
      typeof outcomeData.symbol === "string"
        ? outcomeData.symbol.slice(0, 40)
        : null,
    timeframe:
      typeof outcomeData.timeframe === "string"
        ? outcomeData.timeframe.slice(0, 20)
        : null,
    notes:
      typeof outcomeData.notes === "string"
        ? outcomeData.notes.slice(0, 500)
        : null,
  };
  const expectedAuthSubject =
    typeof outcomeData.expectedAuthSubject === "string"
      ? outcomeData.expectedAuthSubject
      : null;
  return apiRequest("/submit-review-outcome", {
    method: "POST",
    body: JSON.stringify(payload),
    expectedAuthSubject,
  });
}
