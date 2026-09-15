async function submitProductFeedbackFromPanel(payload) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "submitProductFeedback",
      data: payload,
    });
    return response?.success === true;
  } catch (error) {
    console.debug("ChartMentor: Product feedback submission failed", error);
    return false;
  }
}

async function submitFeedback(
  analysisData,
  feedbackValue,
  { durable = true, reason = feedbackValue, details = "", context = null } = {},
) {
  const normalizedValue = String(feedbackValue || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .slice(0, 64);
  await trackPanelEvent("mentor_feedback_clicked", {
    feedbackValue: normalizedValue,
    requestId: analysisData?.requestId || null,
    analysisId: analysisData?.analysisId || analysisData?.id || null,
    responseType: analysisData?.responseType || null,
    reviewMode: analysisData?.reviewMode || null,
    verdict: analysisData?.verdict || null,
    tradeIdeaStatus: analysisData?.tradeIdeaStatus || null,
  });
  if (!durable) return true;
  return submitProductFeedbackFromPanel({
    source: "scan_rating_followup",
    promptId: "scan-rating-followup-v1",
    rating: normalizedValue,
    reason: String(reason || normalizedValue).slice(0, 128),
    details: String(details || "").slice(0, 500),
    analysisId: String(
      analysisData?.analysisId || analysisData?.id || "",
    ).slice(0, 160),
    context,
  });
}
