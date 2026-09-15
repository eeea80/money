function sanitizeChartInfoForAnalysis(chartInfo = {}) {
  const confidence = normalizePanelText(
    chartInfo.symbolConfidence,
  ).toLowerCase();
  const reliableSymbol =
    chartInfo.symbolSource === "user" ||
    confidence === "high" ||
    confidence === "medium";
  if (reliableSymbol && !isPlaceholderSymbol(chartInfo.symbol))
    return chartInfo;
  return {
    ...chartInfo,
    symbol: "UNKNOWN",
    timeframe: undefined,
    exchange: undefined,
    symbolSource: undefined,
    timeframeSource: undefined,
  };
}

function resetAnalysisStartupState() {
  state.isAnalyzing = false;
  state.activeScanIsProactive = false;
  showLoading(false);
  renderIdleSuggestion();
  updateReviewModeUI();
  if (elements.analyzeBtn) {
    elements.analyzeBtn.classList.remove("analyzing");
    elements.analyzeBtn.disabled = shouldDisableAnalyzeButton();
  }
}

async function startAnalysis(preCapturedScreenshot = null, options = {}) {
  if (state.isAnalyzing || state.isClearingSession) return;
  const isFollowUp = options.interactionType === "follow_up";
  const initialPrompt = !isFollowUp
    ? normalizePanelText(options.initialPrompt || "")
    : "";
  // Set this synchronously, before any await, so a second click fired while
  // the auth-token lookup below is still pending can't slip past the guard
  // above and run a second, overlapping scan (the two would both mutate
  // shared state, and the first one finishing would re-enable the UI while
  // the second was still in flight - looked like a stuck/"infinite loading"
  // panel). Every early return between here and the main try/finally below
  // must reset this back to false, since only the try/finally resets it.
  state.isAnalyzing = true;
  state.activeScanIsProactive = options.isProactive === true;
  const scanGeneration = state.scanGeneration;
  if (elements.analyzeBtn) {
    elements.analyzeBtn.classList.add("analyzing");
    elements.analyzeBtn.disabled = true;
  }
  switchTab("review");
  showLoading(true);
  if (!initialPrompt) showAnalysisTypingBubble();
  renderIdleSuggestion();
  updateReviewModeUI();

  const requestAuthToken = await ChartMentorStorage.getAuthToken();
  if (state.scanGeneration !== scanGeneration) {
    resetAnalysisStartupState();
    return;
  }
  const requestAuthSubject = getHistoryOwnerSubjectFromToken(requestAuthToken);
  const isAuthenticated = Boolean(requestAuthSubject);
  state.isAuthenticated = isAuthenticated;
  if (!isAuthenticated) {
    resetAnalysisStartupState();
    window.open(
      buildSignupUrl({ signup_context: "extension_analysis" }),
      "_blank",
    );
    return;
  }

  const resolvedPanelTabScope = await waitForPanelTabScope();
  if (state.scanGeneration !== scanGeneration) {
    resetAnalysisStartupState();
    return;
  }
  if (!resolvedPanelTabScope) {
    resetAnalysisStartupState();
    addMessage(
      "assistant",
      "The panel is still connecting to this tab. Please try the scan again in a moment.",
      { isAnalysisError: true },
    );
    updateReviewModeUI();
    return;
  }

  const preCapturedPayload = normalizeScreenshotPayload(preCapturedScreenshot);
  // Every mentor turn sees the current chart. Explicit reviews, proactive
  // briefs, and follow-ups all fail closed when a fresh capture is unavailable.
  const includeScreenshotForRequest = true;
  if (
    !preCapturedPayload.dataUrl &&
    includeScreenshotForRequest &&
    !isExtensionReadyForAnalysis()
  ) {
    resetAnalysisStartupState();
    return;
  }

  const activeReviewMode = normalizeStoredReviewMode(
    state.currentReviewMode ||
      state.settings?.reviewMode ||
      DEFAULT_SETTINGS.reviewMode,
  );
  state.currentReviewMode = activeReviewMode;
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...(state.settings || {}),
    reviewMode: activeReviewMode,
  };

  dismissExtensionOnboarding().catch((error) => {
    console.warn(
      "ChartMentor: Failed to dismiss onboarding from analysis click",
      error,
    );
  });

  // state.isAnalyzing and the button-disable were already set synchronously
  // at the top of this function, before the auth-token await.
  const scanRequestId = createScanRequestId();
  let scanStorageKeys = { activeKey: null, resultKey: null };
  try {
    scanStorageKeys = await getCurrentScanStorageKeys();
    await markScanInProgress(
      scanRequestId,
      scanStorageKeys.activeKey,
      requestAuthSubject,
    );
  } catch (error) {
    console.debug("ChartMentor: Scan recovery storage unavailable", error);
  }
  if (state.scanGeneration !== scanGeneration) {
    void clearScanInProgressMarker(scanRequestId, scanStorageKeys);
    resetAnalysisStartupState();
    return;
  }
  state.activeScanRequestId = scanRequestId;
  state.activeScanOwnerSubject = requestAuthSubject;
  state.activeScanStorageKeys = scanStorageKeys;
  state.isViewingPreviousScan = false;

  let usageWasOptimistic = false;
  let chartInfo = null;
  let screenshotPayload = { dataUrl: null, captureMetadata: null };
  let scanFingerprint = null;
  let currentRequestErrorShown = false;
  let shouldClearScanRecovery = true;

  try {
    // A normal rescan first ingests the visible chart. If its state is unchanged,
    // reuse the existing result without spending quota or calling the AI again.
    if (!isFollowUp) {
      chartInfo = await getChartInfo();
      if (options.userProvidedSymbol) {
        chartInfo = {
          ...chartInfo,
          ...options.userProvidedSymbol,
          symbolSource: "user",
        };
      }
      chartInfo = sanitizeChartInfoForAnalysis(chartInfo);

      screenshotPayload = preCapturedPayload.dataUrl
        ? preCapturedPayload
        : await requestScreenshotFromContentScript();
      scanFingerprint = await buildChartFingerprint(
        chartInfo,
        screenshotPayload,
        {
          reviewMode: activeReviewMode,
          setupType: state.currentSetupType,
          mentorVoice: normalizeMentorVoice(state.settings?.mentorVoice),
          responseLength: state.settings?.responseLength,
          hasCustomLens: state.settings?.hasCustomLens,
          declaredPlan: options.declaredPlan || null,
        },
      );

      if (
        !initialPrompt &&
        !options.forceRescan &&
        scanFingerprint &&
        state.lastScanSnapshot?.fingerprint === scanFingerprint
      ) {
        renderCachedScan(state.lastScanSnapshot);
        state.currentAnalysis = state.lastScanSnapshot.analysisData;
        state.currentHistoryId =
          state.lastScanSnapshot.historyId || state.currentHistoryId;
        finishAnalysisUi();
        return;
      }

      preserveAndResetActiveConversation();
    }

    // 2. Refresh stale credits before the gate so it cannot race the in-flight analysis response.
    if (isAuthenticated && !hasFreshUserSync(state.user)) {
      await refreshUserDataFromBackend(true);
    }

    // The backend owns the bounded free follow-up allowance. A local scan gate
    // would block that value before the server can apply the correct policy.
    if (!isFollowUp && !checkScanLimit()) {
      state.paywallDismissed = false; // Force show on user action
      const usageGate = getCurrentUsageGate();
      showBlockedReviewPaywall(usageGate);
      state.isAnalyzing = false;
      showLoading(false);
      if (elements.analyzeBtn) {
        elements.analyzeBtn.classList.remove("analyzing");
        elements.analyzeBtn.disabled = shouldDisableAnalyzeButton();
      }
      return;
    }

    // Get fresh chart context, then discard unreliable hints before analysis.
    if (!chartInfo) {
      chartInfo = await getChartInfo();
    }
    if (options.userProvidedSymbol) {
      chartInfo = {
        ...chartInfo,
        ...options.userProvidedSymbol,
        symbolSource: "user",
      };
    }
    chartInfo = sanitizeChartInfoForAnalysis(chartInfo);

    if (!isFollowUp) {
      state.awaitingSymbolForAnalysis = null;
    }

    const screenshotPromise = includeScreenshotForRequest
      ? !isFollowUp
        ? Promise.resolve(screenshotPayload)
        : preCapturedPayload.dataUrl
          ? Promise.resolve(preCapturedPayload)
          : requestScreenshotFromContentScript()
      : Promise.resolve({ dataUrl: null, captureMetadata: null });

    // Reset chat history if symbol changed
    if (state.currentSymbol && state.currentSymbol !== chartInfo.symbol) {
      console.log(
        `ChartMentor: Symbol changed from ${state.currentSymbol} to ${chartInfo.symbol}. Clearing chat history.`,
      );
      // Bump the staleness generation here too, not just in the passive
      // symbolChanged listener - a fast rescan on a new symbol can reach
      // this point before that debounced listener catches up, and without
      // this the in-flight-from-the-old-symbol response would pass the
      // stale-response check below and get shown under the new symbol.
      state.chartContextRevision += 1;
      preserveAndResetActiveConversation();
      const latestFollowUpMessage = isFollowUp
        ? [...state.messages]
            .reverse()
            .find((message) => message.role === "user")
        : null;
      state.messages = latestFollowUpMessage ? [latestFollowUpMessage] : [];
      if (elements.chatMessages) {
        elements.chatMessages.innerHTML = "";
        if (latestFollowUpMessage) {
          setReviewContentMode(true);
          renderMessage(latestFollowUpMessage);
        } else {
          setReviewContentMode(false);
          elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
          renderIdleSuggestion();
        }
      }
    }
    state.currentSymbol = isPlaceholderSymbol(chartInfo.symbol)
      ? null
      : chartInfo.symbol;
    if (initialPrompt) {
      clearReviewPlaceholder();
      setReviewContentMode(true);
      addMessage("user", initialPrompt);
    }
    showAnalysisTypingBubble();

    // 5. Handle screenshot capture
    const resolvedScreenshotPayload = normalizeScreenshotPayload(
      await screenshotPromise,
    );
    let screenshotToUse = resolvedScreenshotPayload.dataUrl;
    const captureMetadata = resolvedScreenshotPayload.captureMetadata || null;
    if (!screenshotToUse) {
      console.error("ChartMentor: Failed to get screenshot from content script");
      addMessage(
        "assistant",
        "I lost sight of the chart, so I stopped instead of answering from stale context. Keep TradingView visible and try again.",
        { isAnalysisError: true, responseReady: true },
      );
      currentRequestErrorShown = true;
      return;
    } else {
      console.log(
        "ChartMentor: Screenshot ready, length:",
        screenshotToUse.length,
      );
      if (preCapturedPayload.dataUrl && captureMetadata?.compressed !== true) {
        try {
          screenshotToUse = await compressScreenshotDataUrl(screenshotToUse);
        } catch (compressionError) {
          console.error(
            "ChartMentor: Pre-captured screenshot compression failed",
            compressionError,
          );
        }
      }
    }

    // 6. Bind the request to the account that started it.
    const currentAuthToken = await ChartMentorStorage.getAuthToken();
    if (
      getHistoryOwnerSubjectFromToken(currentAuthToken) !== requestAuthSubject
    ) {
      console.log("ChartMentor: Account changed before analysis submission.");
      addMessage(
        "assistant",
        "Your account changed while this scan was starting. Run it again from the active account.",
        { isAnalysisError: true },
      );
      currentRequestErrorShown = true;
      return;
    }

    // 7. Send to background for analysis
    const reviewModeToSend = toBackendReviewMode(activeReviewMode);
    const setupTypeToSend = state.currentSetupType;
    // Attach the now-known chart context to the in-progress marker so a
    // recovery boot (reportInterruptedScanIfAny) can replay this scan's
    // result if the panel gets rebuilt before the response lands.
    await attachScanContext(scanRequestId, scanStorageKeys.activeKey, {
      chartInfo,
      scanFingerprint,
      isFollowUp,
      activeReviewMode,
      declaredPlan: options.declaredPlan || null,
    });
    if (
      state.activeScanRequestId !== scanRequestId ||
      state.scanGeneration !== scanGeneration
    ) {
      return;
    }
    const analysisRequest = chrome.runtime.sendMessage({
      type: "analyzeChart",
      data: {
        chartContext: chartInfo,
        messages: getBackendMessages(8, { includeHiddenContext: isFollowUp }),
        screenshot: screenshotToUse,
        captureMetadata,
        local_date: new Date().toLocaleDateString("en-CA"), // YYYY-MM-DD in local timezone
        reviewMode: reviewModeToSend,
        setupType: setupTypeToSend,
        responseLength: state.settings?.responseLength || "standard",
        mentorVoice: normalizeMentorVoice(state.settings?.mentorVoice),
        interactionType: options.interactionType || "analysis",
        expectedAuthSubject: requestAuthSubject,
        requestId: scanRequestId,
        panelTabScope: state.panelTabScope,
        // Plan-first activation: only present when the user explicitly
        // confirmed a detected TradingView plan or completed the manual
        // fallback form (see panel-plan-first.js). The visible primary flow
        // has no plain chart-context scan entry point.
        ...(options.declaredPlan && typeof options.declaredPlan === "object"
          ? { declaredPlan: options.declaredPlan }
          : {}),
      },
    });
    const requestChartContextRevision = state.chartContextRevision;
    usageWasOptimistic = isFollowUp ? false : applyOptimisticUsageCharge();
    const response = await analysisRequest;
    if (state.activeScanRequestId !== scanRequestId) return;
    const responseAuthToken = await ChartMentorStorage.getAuthToken();
    if (
      getHistoryOwnerSubjectFromToken(responseAuthToken) !== requestAuthSubject
    ) {
      console.log(
        "ChartMentor: Ignoring analysis response from a previous account.",
      );
      currentRequestErrorShown = true;
      return;
    }

    if (requestChartContextRevision !== state.chartContextRevision) {
      // The request belongs to the chart captured above. It must not be shown
      // as the live chart's analysis, but it also must not disappear after a
      // paid request completed. Keep it as a clearly labelled previous scan.
      const visibleContext = {
        symbol: state.currentSymbol,
        timeframe: state.currentTimeframe,
        symbolConfidence: state.symbolConfidence,
      };
      if (response.success) {
        state.isViewingPreviousScan = true;
        shouldClearScanRecovery = false;
        const handoff = await processAnalysisResponse(
          response,
          isFollowUp,
          activeReviewMode,
          scanFingerprint,
          chartInfo,
          preCapturedPayload,
          {
            dataUrl: screenshotToUse,
            captureMetadata,
          },
          {
            ...options,
            isPreviousScan: true,
            requestId: scanRequestId,
            expectedAuthSubject: requestAuthSubject,
          },
        );
        shouldClearScanRecovery = handoff?.durableRecovery === true;
        state.currentSymbol = visibleContext.symbol;
        state.currentTimeframe = visibleContext.timeframe;
        state.symbolConfidence = visibleContext.symbolConfidence;
      } else {
        state.isViewingPreviousScan = false;
        currentRequestErrorShown = true;
        addMessage(
          "assistant",
          response.error ||
            "The scan could not finish after the chart changed.",
          { isAnalysisError: true, responseReady: true },
        );
      }
      return;
    }

    if (response.success) {
      shouldClearScanRecovery = false;
      const handoff = await processAnalysisResponse(
        response,
        isFollowUp,
        activeReviewMode,
        scanFingerprint,
        chartInfo,
        preCapturedPayload,
        {
          dataUrl: screenshotToUse,
          captureMetadata,
        },
        {
          ...options,
          requestId: scanRequestId,
          expectedAuthSubject: requestAuthSubject,
        },
      );
      shouldClearScanRecovery = handoff?.durableRecovery === true;
      if (!isFollowUp) await refreshUserDataFromBackend(true);
    } else {
      showLoading(false);
      console.error(
        "ChartMentor: Analysis failed - Full response:",
        JSON.stringify(response, null, 2),
      );

      const errorCode =
        response.errorCode || response.code || response.data?.code;
      const errorMessage =
        response.error || response.data?.error || "Failed to review this plan";

      const isLimitError =
        errorCode === "insufficient_credits" ||
        errorCode === "daily_limit_reached";
      const usagePayloadApplied = response.data
        ? await applyUsagePayload(response.data)
        : false;

      if (isLimitError) {
        if (!usagePayloadApplied) await refreshUserDataFromBackend(true);
      } else if (usageWasOptimistic && !usagePayloadApplied) {
        await refreshUserDataFromBackend(true);
      }

      if (isLimitError) {
        addUpgradePrompt(
          errorCode === "daily_limit_reached" ? "daily" : "monthly",
        );
        currentRequestErrorShown = true;
      } else if (errorCode === "follow_up_requires_paid_plan") {
        addUpgradePrompt("monthly", {
          gateType: "follow-up-gate",
          content: isDollarTrialTreatmentOffer()
            ? "Follow-up questions are part of Pro. Start seven days for $1 today. Then $39.99/month unless canceled."
            : "Follow-up questions are part of Pro. Upgrade to keep the conversation going.",
          ctaLabel: isDollarTrialTreatmentOffer()
            ? "Start 7-Day Pro for $1"
            : "Upgrade to Pro",
          upgradeUrl:
            response.upgradeUrl || getExtensionPricingUrl("follow_up_gate"),
          checkoutSource: "extension_follow_up_gate",
        });
        currentRequestErrorShown = true;
      } else if (errorCode === "account_changed") {
        addMessage(
          "assistant",
          "Your account changed while this scan was starting. Run it again from the active account.",
          { isAnalysisError: true },
        );
        currentRequestErrorShown = true;
      } else if (errorCode === "declared_plan_required") {
        openManualPlanModal();
        currentRequestErrorShown = true;
      } else if (errorCode === "symbol_required") {
        requestSymbolForAnalysis({ interactionType: "analysis" });
        currentRequestErrorShown = true;
      } else if (errorCode === "request_timeout") {
        addMessage(
          "assistant",
          "This scan took too long, so I stopped it instead of leaving you hanging. Clean up the chart, zoom out enough to show structure, and run it again.",
          { isAnalysisError: true },
        );
        currentRequestErrorShown = true;
      } else if (
        errorCode === "invalid_token" ||
        errorCode === "session_expired" ||
        errorMessage.includes("token")
      ) {
        addMessage(
          "assistant",
          "Session expired. Log in again to continue scanning charts.",
          {
            isAuthRequired: true,
          },
        );
        currentRequestErrorShown = true;
      } else if (
        errorCode === "prepare_failed" ||
        errorCode === "ai_call_failed" ||
        errorCode === "normalization_failed" ||
        errorCode === "persist_failed"
      ) {
        addMessage(
          "assistant",
          "Something went wrong processing that scan. Try again — if it keeps happening, contact support.",
          { isAnalysisError: true },
        );
        currentRequestErrorShown = true;
      } else {
        addMessage("assistant", `Error: ${errorMessage}`, {
          isAnalysisError: true,
        });
        currentRequestErrorShown = true;
      }
    }
  } catch (error) {
    if (state.activeScanRequestId !== scanRequestId) return;
    console.error("ChartMentor: Analysis error", error);
    showLoading(false);
    if (usageWasOptimistic) {
      await refreshUserDataFromBackend(true);
    }

    if (!currentRequestErrorShown) {
      addMessage(
        "assistant",
        "There was an error analyzing the chart. Please try again.",
        { isAnalysisError: true },
      );
    }
  } finally {
    const ownsActiveScan = state.activeScanRequestId === scanRequestId;
    if (ownsActiveScan) {
      state.isAnalyzing = false;
      state.activeScanRequestId = null;
      state.activeScanOwnerSubject = null;
      state.activeScanStorageKeys = null;
      state.activeScanIsProactive = false;
    }
    if (shouldClearScanRecovery) {
      void clearScanInProgressMarker(scanRequestId, scanStorageKeys);
    }
    if (!ownsActiveScan) return;
    showLoading(false);
    renderIdleSuggestion();
    updateReviewModeUI();
    if (elements.analyzeBtn) {
      elements.analyzeBtn.classList.remove("analyzing");
      elements.analyzeBtn.disabled = shouldDisableAnalyzeButton();
    }
  }
}
