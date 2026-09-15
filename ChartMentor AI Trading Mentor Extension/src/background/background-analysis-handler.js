async function handleAnalyzeChartRequest(request, sender) {
  let analysisLifecycle = null;
  try {
    console.log("ChartMentor: analyzeChart request received");
    const requestData = request?.data || {};
    const {
      messages,
      local_date,
      reviewMode,
      setupType,
      responseLength,
      mentorVoice,
      interactionType,
      captureMetadata,
      expectedAuthSubject,
      declaredPlan,
    } = requestData;
    const authState = await chrome.storage.local.get([STORAGE_KEYS.AUTH_TOKEN]);
    const activeAuthSubject = decodeJwtSubject(
      authState[STORAGE_KEYS.AUTH_TOKEN] || sessionData?.access_token || null,
    );
    if (!activeAuthSubject) {
      return {
        success: false,
        error: "Create a free account to analyze charts.",
        code: "auth_required",
      };
    }
    if (!expectedAuthSubject || activeAuthSubject !== expectedAuthSubject) {
      return {
        success: false,
        error: "The active account changed before the scan could start.",
        code: "account_changed",
      };
    }

    let dataUrl = requestData.screenshot;
    const effectiveCaptureMetadata = sanitizeCaptureMetadata(captureMetadata);
    if (!isUsableScreenshotDataUrl(dataUrl)) dataUrl = null;
    if (!dataUrl) {
      return {
        success: false,
        error:
          "A current TradingView chart screenshot is required. Keep TradingView visible and try again.",
        code: "screenshot_required",
      };
    }

    const latestAuthState = await chrome.storage.local.get([
      STORAGE_KEYS.AUTH_TOKEN,
    ]);
    const latestAuthSubject = decodeJwtSubject(
      latestAuthState[STORAGE_KEYS.AUTH_TOKEN] ||
        sessionData?.access_token ||
        null,
    );
    if (latestAuthSubject !== expectedAuthSubject) {
      return {
        success: false,
        error: "The active account changed while the scan was being prepared.",
        code: "account_changed",
      };
    }

    const chartContext = requestData.chartContext || {
      symbol: requestData.symbol,
      timeframe: requestData.timeframe,
    };
    void trackAnalyticsEvent("extension_analysis_started", {
      reviewMode: reviewMode || "review",
      setupType: setupType || null,
      responseLength: responseLength || "standard",
      mentorVoice: normalizeMentorVoice(mentorVoice),
      interactionType: interactionType || "analysis",
      hasScreenshot: Boolean(dataUrl),
      captureMethod: effectiveCaptureMetadata?.captureMethod || null,
    });

    const analysisRequestId = isValidAnalysisRequestId(requestData.requestId)
      ? requestData.requestId
      : null;
    const panelTabScope = isValidPanelTabScope(requestData.panelTabScope)
      ? requestData.panelTabScope
      : null;
    analysisLifecycle = registerActiveAnalysis({
      tabId: sender?.tab?.id,
      requestId: analysisRequestId,
      ownerSubject: expectedAuthSubject,
    });
    if (analysisLifecycle) {
      try {
        await chrome.tabs.get(sender.tab.id);
      } catch {
        analysisLifecycle.controller.abort();
      }
    }

    const result = await analyzeChart(
      chartContext,
      messages,
      dataUrl,
      local_date,
      reviewMode,
      setupType,
      responseLength,
      mentorVoice,
      interactionType,
      effectiveCaptureMetadata,
      expectedAuthSubject,
      analysisLifecycle?.controller.signal || null,
      declaredPlan,
    );

    const resultStorageKey = getScanResultStorageKey(
      expectedAuthSubject,
      panelTabScope,
    );
    if (
      analysisRequestId &&
      resultStorageKey &&
      result?.code !== "request_cancelled" &&
      !analysisLifecycle?.controller.signal.aborted
    ) {
      try {
        await chrome.storage.local.set({
          [resultStorageKey]: {
            requestId: analysisRequestId,
            result,
            completedAt: Date.now(),
          },
        });
      } catch (error) {
        console.debug(
          "ChartMentor: Failed to persist scan result for recovery",
          error,
        );
      }
    }

    void trackAnalyticsEvent(
      result?.success
        ? "extension_analysis_completed"
        : "extension_analysis_failed",
      {
        reviewMode: reviewMode || "review",
        setupType: setupType || null,
        responseLength: responseLength || "standard",
        interactionType: interactionType || "analysis",
        errorCode: result?.success
          ? null
          : result?.code || result?.data?.code || "unknown",
      },
    );
    return result;
  } catch (error) {
    console.error("ChartMentor: analyzeChart error:", error.message);
    void trackAnalyticsEvent("extension_analysis_failed", {
      errorCode: "background_exception",
    });
    return { success: false, error: error.message };
  } finally {
    releaseActiveAnalysis(analysisLifecycle?.key);
  }
}
