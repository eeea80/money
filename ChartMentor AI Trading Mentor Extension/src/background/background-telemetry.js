/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Authenticated analytics and product feedback helpers
 */

async function hasStoredAuthToken() {
  await sessionRestorePromise;
  const authState = await chrome.storage.local.get([STORAGE_KEYS.AUTH_TOKEN]);
  return Boolean(
    authState?.[STORAGE_KEYS.AUTH_TOKEN] || sessionData?.access_token,
  );
}

async function trackAnalyticsEvent(eventName, eventData = {}) {
  try {
    const authState = await chrome.storage.local.get([STORAGE_KEYS.AUTH_TOKEN]);
    if (!authState?.[STORAGE_KEYS.AUTH_TOKEN] && !sessionData?.access_token) {
      return { success: false, error: "not_authenticated" };
    }

    const extensionVersion = chrome.runtime.getManifest?.().version;
    const extensionInstallId = await getExtensionInstallId();
    const result = await apiRequest("/emit-event", {
      method: "POST",
      body: JSON.stringify({
        event_name: eventName,
        event_data: {
          ...eventData,
          source: "chrome_extension",
          extensionVersion,
          extensionInstallId,
        },
      }),
    });

    if (!result.success) {
      console.debug(
        "ChartMentor: Analytics event not recorded",
        eventName,
        result.error || result.code,
      );
    }
    return result;
  } catch (error) {
    console.debug("ChartMentor: Analytics event error", eventName, error);
    return { success: false, error: error.message };
  }
}

const PRODUCT_FEEDBACK_SOURCES = new Set([
  "scan_rating_followup",
  "founder_prompt",
]);
const PRODUCT_FEEDBACK_RATINGS = new Set([
  "useful",
  "not_helpful",
  "too_vague",
  "wrong_read",
]);
const PRODUCT_FEEDBACK_CONTEXT_KEYS = new Set([
  "responseType",
  "reviewMode",
  "verdict",
  "tradeIdeaStatus",
  "signalCount",
  "hasWatchCondition",
  "lastValueMoment",
]);

function sanitizeProductFeedbackPayload(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  const source =
    typeof raw.source === "string" ? raw.source.trim().toLowerCase() : "";
  const promptId =
    typeof raw.promptId === "string" ? raw.promptId.trim().slice(0, 128) : "";
  const reason =
    typeof raw.reason === "string" ? raw.reason.trim().slice(0, 128) : "";
  if (!PRODUCT_FEEDBACK_SOURCES.has(source) || !promptId || !reason) {
    return null;
  }

  const payload = { source, promptId, reason };
  if (typeof raw.rating === "string") {
    const rating = raw.rating.trim().toLowerCase();
    if (PRODUCT_FEEDBACK_RATINGS.has(rating)) payload.rating = rating;
  }
  if (typeof raw.details === "string") {
    const details = raw.details.trim().slice(0, 500);
    if (details) payload.details = details;
  }
  if (typeof raw.analysisId === "string") {
    const analysisId = raw.analysisId.trim().slice(0, 160);
    if (analysisId) payload.analysisId = analysisId;
  }
  if (raw.context && typeof raw.context === "object") {
    const context = {};
    for (const [key, value] of Object.entries(raw.context)) {
      if (!PRODUCT_FEEDBACK_CONTEXT_KEYS.has(key)) continue;
      if (typeof value === "string") {
        const bounded = value.trim().slice(0, 120);
        if (bounded) context[key] = bounded;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        context[key] = Math.max(0, Math.min(100000, value));
      } else if (typeof value === "boolean") {
        context[key] = value;
      }
    }
    if (Object.keys(context).length) payload.context = context;
  }
  return payload;
}

async function submitProductFeedback(feedbackData = {}) {
  const payload = sanitizeProductFeedbackPayload(feedbackData);
  if (!payload) {
    return { success: false, error: "Invalid product feedback payload" };
  }
  const expectedAuthSubject =
    typeof feedbackData.expectedAuthSubject === "string"
      ? feedbackData.expectedAuthSubject
      : null;
  return apiRequest("/submit-product-feedback", {
    method: "POST",
    body: JSON.stringify(payload),
    expectedAuthSubject,
  });
}
