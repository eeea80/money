const MENTOR_SESSION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeMentorSessionChartHint(value) {
  const input = value && typeof value === "object" ? value : {};
  const symbol = typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : null;
  const timeframe = typeof input.timeframe === "string" ? input.timeframe.trim() : null;
  const symbolConfidence = ["high", "medium", "low", "none"].includes(input.symbolConfidence)
    ? input.symbolConfidence
    : "none";
  return {
    symbol: symbol && /^[A-Z0-9][A-Z0-9._:/=-]{0,31}$/.test(symbol) ? symbol : null,
    timeframe: timeframe && /^(?:[1-9]\d{0,3})(?:s|m|h|d|w|M)$/.test(timeframe)
      ? timeframe
      : null,
    symbolConfidence,
  };
}

async function handleMentorSessionRequest(data = {}) {
  const expectedAuthSubject =
    typeof data.expectedAuthSubject === "string" ? data.expectedAuthSubject : null;
  const action = ["open", "reply", "nudge"].includes(data.action)
    ? data.action
    : null;
  const turnId = String(data.turnId || "").toLowerCase();
  const timezone = typeof data.timezone === "string" ? data.timezone.slice(0, 80) : "";
  if (!expectedAuthSubject || !action || !MENTOR_SESSION_UUID_PATTERN.test(turnId) || !timezone) {
    return { success: false, error: "Invalid mentor session request.", code: "invalid_request" };
  }
  const body = {
    action,
    turnId,
    timezone,
    chartHint: normalizeMentorSessionChartHint(data.chartHint),
  };
  if (action === "open") {
    body.forceNew = data.forceNew === true;
  } else {
    const conversationId = String(data.conversationId || "").toLowerCase();
    if (!MENTOR_SESSION_UUID_PATTERN.test(conversationId)) {
      return { success: false, error: "Invalid mentor conversation.", code: "invalid_request" };
    }
    body.conversationId = conversationId;
    if (action === "nudge") {
      return apiRequest("/mentor-session", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 75_000,
        expectedAuthSubject,
      });
    }
    const messageId = String(data.messageId || "").toLowerCase();
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (
      !MENTOR_SESSION_UUID_PATTERN.test(messageId) ||
      !text ||
      text.length > 2_000
    ) {
      return { success: false, error: "Invalid mentor session reply.", code: "invalid_request" };
    }
    body.messageId = messageId;
    body.text = text;
  }
  return apiRequest("/mentor-session", {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs: 75_000,
    expectedAuthSubject,
  });
}
