/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Background Service Worker API helpers
 */

// Consumes an SSE response from analyze-chart. Terminal `event: result` or
// `event: error` frames preserve the response shape expected by callers.
const MAX_ANALYSIS_SSE_BUFFER_CHARS = 1024 * 1024;

async function consumeAnalysisEventStream(
  response,
  { didTimeout = () => false, didCancel = () => false, timeoutMs = null } = {},
) {
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      success: false,
      error: "Empty streaming response from server.",
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let resultData = null;
  let errorData = null;

  const getTerminalResponse = () => {
    if (errorData) {
      return {
        success: false,
        error: errorData.error || "Failed to analyze chart",
        code: errorData.code,
        data: errorData,
      };
    }
    if (resultData) return { success: true, data: resultData };
    return null;
  };

  const cancelReader = async () => {
    try {
      await reader.cancel();
    } catch {
      // A terminal SSE event is already enough to complete the request; a
      // transport that is concurrently closing does not change that result.
    }
  };

  const handleFrame = (frame) => {
    let eventName = "message";
    const dataLines = [];
    for (const rawLine of frame.split(/\r?\n/)) {
      const line = rawLine.replace(/^\uFEFF/, "");
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim().toLowerCase();
      } else if (line.startsWith("data:")) {
        // SSE joins repeated data fields with a newline. Keeping that newline
        // also preserves valid JSON whitespace when a provider wraps a frame.
        dataLines.push(line.slice(5).replace(/^ /, ""));
      } else if (line === "data") {
        dataLines.push("");
      }
    }

    const dataText = dataLines.join("\n");
    if (dataText === "[DONE]") return true;
    if (!dataText) {
      return ["done", "complete", "completed", "terminal"].includes(eventName);
    }

    let parsed;
    try {
      parsed = JSON.parse(dataText);
    } catch {
      return false;
    }

    const payloadType =
      typeof parsed?.type === "string" ? parsed.type.toLowerCase() : null;

    if (
      ["result", "complete", "completed", "final"].includes(eventName) ||
      ["result", "complete", "completed", "final"].includes(payloadType)
    ) {
      resultData = parsed?.result || parsed?.data || parsed;
      return true;
    }
    if (eventName === "error" || payloadType === "error") {
      errorData =
        parsed?.error && typeof parsed.error === "object"
          ? { ...parsed.error, code: parsed.error.code || parsed.code }
          : parsed;
      return true;
    }
    return ["done", "terminal"].includes(eventName);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_ANALYSIS_SSE_BUFFER_CHARS) {
        await cancelReader();
        return {
          success: false,
          error: "The streaming response was unexpectedly large. Try again.",
          code: "invalid_stream",
        };
      }
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        if (handleFrame(frame)) {
          await cancelReader();
          return (
            getTerminalResponse() || {
              success: false,
              error: "The scan stream ended without a result. Try again.",
              code: "stream_ended",
            }
          );
        }
      }
    }
    buffer += decoder.decode();
  } catch (error) {
    if (didCancel()) {
      return {
        success: false,
        error:
          "The scan was cancelled because its TradingView tab closed or changed account.",
        code: "request_cancelled",
        cancelled: true,
      };
    }
    if (didTimeout()) {
      const timeoutSeconds = Math.round((timeoutMs || 0) / 1000);
      return {
        success: false,
        error: `ChartMentor took longer than ${timeoutSeconds}s to answer. Try again with a cleaner chart or a shorter scan.`,
        code: "request_timeout",
      };
    }
    throw error;
  }
  if (buffer.trim() && handleFrame(buffer)) {
    await cancelReader();
    return (
      getTerminalResponse() || {
        success: false,
        error: "The scan stream ended without a result. Try again.",
        code: "stream_ended",
      }
    );
  }
  const terminalResponse = getTerminalResponse();
  if (terminalResponse) return terminalResponse;
  return {
    success: false,
    error: "The scan stream ended without a result. Try again.",
  };
}

async function apiRequest(endpoint, options = {}) {
  await sessionRestorePromise;

  const expectedAuthSubject =
    typeof options.expectedAuthSubject === "string"
      ? options.expectedAuthSubject
      : null;
  const storageStagingStatus = await new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.USE_PREVIEW_BACKEND], (result) => {
      resolve(!!result[STORAGE_KEYS.USE_PREVIEW_BACKEND]);
    });
  });

  if (storageStagingStatus) {
    console.warn(
      "ChartMentor: Clearing stale preview-backend flag for extension requests.",
    );
    chrome.storage.local
      .remove([STORAGE_KEYS.USE_PREVIEW_BACKEND])
      .catch((error) => {
        console.error(
          "ChartMentor: Failed to clear preview-backend flag",
          error,
        );
      });
  }

  // Get auth token from storage
  let token = await new Promise((resolve) => {
    chrome.storage.local.get(["chartmentor_auth_token"], (result) => {
      resolve(result.chartmentor_auth_token);
    });
  });

  if (expectedAuthSubject && decodeJwtSubject(token) !== expectedAuthSubject) {
    return {
      success: false,
      error: "The active account changed before the request was sent.",
      code: "account_changed",
    };
  }

  // Check if we need to refresh the token
  if (sessionData && isTokenExpired(sessionData.expires_at)) {
    const hadRefreshToken = Boolean(sessionData.refresh_token);
    token = await refreshAccessTokenWithRetry();
    if (!token) {
      if (!hadRefreshToken && typeof clearStoredAuthSession === "function") {
        await clearStoredAuthSession("no usable refresh token");
      }
      return {
        success: false,
        error: "Session expired. Please log in again.",
        code: "session_expired",
      };
    }
  }

  if (expectedAuthSubject && decodeJwtSubject(token) !== expectedAuthSubject) {
    return {
      success: false,
      error: "The active account changed while authentication refreshed.",
      code: "account_changed",
    };
  }

  async function performApiRequest(apiBase, includeApiKey, label) {
    const url = `${apiBase}${endpoint}`;
    const {
      timeoutMs = DEFAULT_API_REQUEST_TIMEOUT_MS,
      expectedAuthSubject: _expectedAuthSubject,
      abortSignal,
      ...fetchOptions
    } = options;
    const headers = {
      "Content-Type": "application/json",
      ...(includeApiKey
        ? { apikey: CHARTMENTOR_CONFIG.SUPABASE_ANON_KEY }
        : {}),
      ...fetchOptions.headers,
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const responseTimeouts = new WeakMap();
    const fetchWithTimeout = async (fetchUrl, requestOptions) => {
      const controller = new AbortController();
      const timeoutState = {
        timedOut: false,
        cancelled: false,
        timeoutId: setTimeout(() => {
          timeoutState.timedOut = true;
          controller.abort();
        }, timeoutMs),
      };
      const abortForExternalSignal = () => {
        timeoutState.cancelled = true;
        controller.abort();
      };
      if (abortSignal) {
        if (abortSignal.aborted) {
          abortForExternalSignal();
        } else {
          abortSignal.addEventListener("abort", abortForExternalSignal, {
            once: true,
          });
        }
      }
      timeoutState.abortForExternalSignal = abortForExternalSignal;

      try {
        const response = await fetch(fetchUrl, {
          ...requestOptions,
          signal: controller.signal,
        });
        // Keep the deadline alive while an SSE body is consumed. Fetch resolves
        // when headers arrive, which is much earlier than a streamed result.
        responseTimeouts.set(response, timeoutState);
        return response;
      } catch (error) {
        clearTimeout(timeoutState.timeoutId);
        abortSignal?.removeEventListener(
          "abort",
          timeoutState.abortForExternalSignal,
        );
        if (timeoutState.timedOut) {
          const timeoutSeconds = Math.round(timeoutMs / 1000);
          const timeoutError = new Error(
            `ChartMentor took longer than ${timeoutSeconds}s to answer. Try again with a cleaner chart or a shorter scan.`,
          );
          timeoutError.code = "request_timeout";
          throw timeoutError;
        }
        if (timeoutState.cancelled) {
          const cancelledError = new Error(
            "The scan was cancelled because its TradingView tab closed or changed account.",
          );
          cancelledError.code = "request_cancelled";
          throw cancelledError;
        }
        throw error;
      }
    };

    const releaseResponseTimeout = (response) => {
      const timeoutState = responseTimeouts.get(response);
      if (!timeoutState) return;
      clearTimeout(timeoutState.timeoutId);
      abortSignal?.removeEventListener(
        "abort",
        timeoutState.abortForExternalSignal,
      );
      responseTimeouts.delete(response);
    };

    const createRequestTimeoutError = () => {
      const timeoutSeconds = Math.round(timeoutMs / 1000);
      const timeoutError = new Error(
        `ChartMentor took longer than ${timeoutSeconds}s to answer. Try again with a cleaner chart or a shorter scan.`,
      );
      timeoutError.code = "request_timeout";
      return timeoutError;
    };

    const readJsonResponse = async (response) => {
      try {
        return await response.json();
      } catch (error) {
        if (responseTimeouts.get(response)?.timedOut) {
          throw createRequestTimeoutError();
        }
        if (responseTimeouts.get(response)?.cancelled) {
          const cancelledError = new Error(
            "The scan was cancelled because its TradingView tab closed or changed account.",
          );
          cancelledError.code = "request_cancelled";
          throw cancelledError;
        }
        return null;
      }
    };

    const consumeStreamResponse = (response) =>
      consumeAnalysisEventStream(response, {
        didTimeout: () => responseTimeouts.get(response)?.timedOut === true,
        didCancel: () => responseTimeouts.get(response)?.cancelled === true,
        timeoutMs,
      });

    try {
      const response = await fetchWithTimeout(url, {
        ...fetchOptions,
        headers,
      });

      try {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("text/html")) {
          const invalidResponseError = new Error(
            "API returned HTML instead of JSON. Check the endpoint URL.",
          );
          invalidResponseError.code = "invalid_server_response";
          throw invalidResponseError;
        }

        // Accepted analyze-chart requests return their terminal result over
        // SSE. Pre-stream auth, validation, and quota failures remain JSON.
        if (
          response.ok &&
          contentType &&
          contentType.includes("text/event-stream")
        ) {
          return await consumeStreamResponse(response);
        }

        const data = await readJsonResponse(response);

        if (!response.ok) {
          if (
            response.status === 401 ||
            data?.error?.includes("token") ||
            data?.error?.includes("auth")
          ) {
            const hadRefreshToken = Boolean(sessionData?.refresh_token);
            if (sessionData && sessionData.refresh_token) {
              const newToken = await refreshAccessTokenWithRetry();
              if (newToken) {
                if (
                  expectedAuthSubject &&
                  decodeJwtSubject(newToken) !== expectedAuthSubject
                ) {
                  return {
                    success: false,
                    error:
                      "The active account changed while authentication refreshed.",
                    code: "account_changed",
                  };
                }
                headers["Authorization"] = `Bearer ${newToken}`;
                const retryResponse = await fetchWithTimeout(url, {
                  ...fetchOptions,
                  headers,
                });
                try {
                  const retryContentType =
                    retryResponse.headers.get("content-type");
                  if (
                    retryResponse.ok &&
                    retryContentType &&
                    retryContentType.includes("text/event-stream")
                  ) {
                    return await consumeStreamResponse(retryResponse);
                  }
                  const retryData = await readJsonResponse(retryResponse);
                  if (retryResponse.ok) {
                    return { success: true, data: retryData };
                  }
                } finally {
                  releaseResponseTimeout(retryResponse);
                }
              }
            }
            if (
              !hadRefreshToken &&
              typeof clearStoredAuthSession === "function"
            ) {
              await clearStoredAuthSession("auth request rejected");
            }
            return {
              success: false,
              error: "Invalid token. Please log in again.",
              code: "invalid_token",
              status: response.status,
            };
          }

          const errorMessage =
            data?.error || data?.message || `HTTP ${response.status}`;
          const errorCode = data?.code || data?.error_code || data?.errorCode;
          return {
            success: false,
            error: errorMessage,
            code: errorCode,
            status: response.status,
            data,
          };
        }

        return { success: true, data };
      } finally {
        releaseResponseTimeout(response);
      }
    } catch (error) {
      console.error(`ChartMentor API Error (${label}):`, error);
      if (error?.code === "request_timeout") {
        return {
          success: false,
          error: error.message,
          code: "request_timeout",
          timeout: true,
        };
      }
      if (error?.code === "request_cancelled") {
        return {
          success: false,
          error: error.message,
          code: "request_cancelled",
          cancelled: true,
        };
      }
      return { success: false, error: error.message, networkError: true };
    }
  }

  return performApiRequest(CHARTMENTOR_CONFIG.API_BASE_URL, true, "production");
}

// submitReviewOutcome lives in background-outcome-api.js (loaded right after
// this file - see background.js's importScripts list), which depends on the
// apiRequest() helper defined above.

async function analyzeChart(
  chartContext,
  messages,
  screenshotDataUrl,
  localDate,
  reviewMode = "review",
  setupType = null,
  responseLength = "standard",
  mentorVoice = "sharp_mentor",
  interactionType = "analysis",
  captureMetadata = null,
  expectedAuthSubject = null,
  abortSignal = null,
  declaredPlan = null,
) {
  let base64Image = null;

  if (isUsableScreenshotDataUrl(screenshotDataUrl)) {
    base64Image = screenshotDataUrl.split(",")[1] || null;
  }

  if (!base64Image) {
    throw new Error(
      "Screenshot data is missing or invalid. Please ensure the extension has permission to capture the screen.",
    );
  }

  const safeMessages = Array.isArray(messages) ? messages : [];
  const lastUserMessage = [...safeMessages]
    .reverse()
    .find((m) => m.role === "user");
  const userPrompt = lastUserMessage
    ? lastUserMessage.content
    : interactionType === "follow_up"
      ? "Answer the latest follow-up question in plain text using the current chart context. Do not generate a new verdict card unless explicitly requested."
      : interactionType === "question"
        ? "Answer the user's question using the current screenshot and chart context. Use the structured conversational response format."
      : interactionType === "proactive_brief"
        ? "Give a concise current technical mentor brief for this chart. Lead with bias, key technical drivers, and the opposing risk. Do not create a trade or choose a direction for the user."
      : "Review only the plan the trader declared through their Strategy Lens. Use plain text, separate visible facts from questions, flag rule conflicts, and never choose long or short for the trader.";

  const extensionVersion = chrome.runtime.getManifest?.().version || null;
  const requestBody = {
    prompt: userPrompt,
    messages: safeMessages,
    local_date: localDate,
    chartContext,
    reviewMode,
    setupType,
    responseLength,
    mentorVoice: normalizeMentorVoice(mentorVoice),
    interactionType,
    captureMetadata: sanitizeCaptureMetadata(captureMetadata),
    extensionVersion,
    image: base64Image,
    // Plan-first activation payload (declared plan, direction, entry/stop/
    // target) - see panel-plan-first.js. Omit it for generic scans/follow-ups;
    // the backend deliberately rejects a present-but-invalid value.
    ...(declaredPlan && typeof declaredPlan === "object"
      ? { declaredPlan }
      : {}),
  };

  return apiRequest("/analyze-chart", {
    method: "POST",
    body: JSON.stringify(requestBody),
    timeoutMs: ANALYZE_CHART_TIMEOUT_MS,
    expectedAuthSubject,
    abortSignal,
  });
}
