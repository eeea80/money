// Advisory-only version banner: shown when the backend flags the extension's
// reported version as behind app_config.min_supported_extension_version.
// Never blocks scanning. Dismissing hides it for the rest of this panel
// session; it re-evaluates (and can reappear) on the next scan response.
function applyUpdateBannerState(shouldShow) {
  if (!elements.updateBanner) return;
  const visible = shouldShow && !state.updateBannerDismissed;
  elements.updateBanner.hidden = !visible;
}

async function processAnalysisResponse(
  response,
  isFollowUp,
  activeReviewMode,
  scanFingerprint,
  chartInfo,
  preCapturedPayload,
  screenshotPayload,
  options,
) {
  clearStaleAnalysisErrors();
  applyUpdateBannerState(response.data?.updateAvailable === true);
  const isConversationalRequest =
    isFollowUp || options?.interactionType === "question";
  const responseMessageId = isConversationalRequest
    ? isValidConversationUuid(options?.responseMessageId)
      ? options.responseMessageId
      : createConversationUuid()
    : null;
  if (isValidConversationUuid(options?.conversationId)) {
    state.currentConversationId = options.conversationId;
  }

  const terminalSnapshot =
    options?.skipTerminalSnapshot === true
      ? null
      : createTerminalScanSnapshot({
          requestId: options?.requestId,
          response,
          isFollowUp,
          activeReviewMode,
          scanFingerprint,
          chartInfo,
          isPreviousScan: options?.isPreviousScan,
          expectedAuthSubject: options?.expectedAuthSubject,
          declaredPlan: options?.declaredPlan || null,
          conversationId: state.currentConversationId,
          responseMessageId,
        });
  let terminalSnapshotPersisted = false;
  if (terminalSnapshot) {
    terminalSnapshotPersisted = await saveLastViewState(
      options?.historyId || state.currentHistoryId,
      terminalSnapshot,
      options?.expectedAuthSubject,
    );
  }

  // saveLastViewState above is the only await before this point, but it's
  // enough time for the active account to change (a second, newer request
  // can already own the panel by the time this resolves). Re-verify this
  // response's declared owner is still the signed-in account before
  // rendering/persisting anything - otherwise a stale response from the
  // previous account can render into the new account's chat/history.
  if (options?.expectedAuthSubject) {
    const currentToken = await ChartMentorStorage.getAuthToken();
    const currentSubject = getHistoryOwnerSubjectFromToken(currentToken);
    if (currentSubject !== options.expectedAuthSubject) {
      console.log(
        "ChartMentor: Dropping analysis response — account changed while it was being saved.",
      );
      return { durableRecovery: false };
    }
  }

  let analysisData = null;
  if (
    response.data &&
    typeof response.data === "object" &&
    response.data.analysis
  ) {
    analysisData = response.data;
  } else if (typeof response.data === "string") {
    analysisData = extractJson(response.data);
  } else if (response.data && typeof response.data === "object") {
    analysisData = extractJson(JSON.stringify(response.data));
  }

  const responseType =
    response.data?.responseType ||
    (isFollowUp
      ? "follow_up_text"
      : options?.interactionType === "question"
        ? "question_text"
        : "setup_text");
  const isChartQualityBlocked =
    responseType === "chart_quality_blocked" ||
    response.data?.chartQualityBlocked === true ||
    analysisData?.visualPreflight?.isAnalyzable === false;

  if (responseType === "setup_text" && !isChartQualityBlocked) {
    await window.ChartMentorOutcomePrompts?.scheduleFromResponse?.(response, {
      ownerSubject: options?.expectedAuthSubject || null,
      declaredPlan: options?.declaredPlan || null,
    });
  }

  // Keep the image transient: it powers the active visual ticket but is never
  // written into scan history or local storage.
  if (analysisData && responseType === "setup_text" && screenshotPayload?.dataUrl) {
    analysisData.chartScreenshot = screenshotPayload.dataUrl;
  }

  // The renderer decides whether to state a vision-detected plan back for
  // confirmation, and that hinges on whether THIS request already carried a
  // user-supplied plan. The backend echoes declaredPlan only when it accepted
  // one, so fall back to the plan the panel actually sent (recovery replays
  // pass the same value through options). Without this, a confirmed plan
  // would be re-proposed on every turn.
  if (
    analysisData &&
    !analysisData.declaredPlan &&
    options?.declaredPlan &&
    typeof options.declaredPlan === "object"
  ) {
    analysisData.declaredPlan = options.declaredPlan;
  }

  // Keep one continuous state transition: the shared thinking bubble leaves
  // only when the parsed response is ready to enter, avoiding a blank gap.
  stopLoadingSequence({ animate: true });

  if (isChartQualityBlocked && analysisData && analysisData.analysis) {
    renderChartQualityBlockedCard(analysisData);
    markLatestScanCard(scanFingerprint);
  } else if (
    analysisData &&
    analysisData.analysis &&
    (responseType === "follow_up_text" || responseType === "question_text")
  ) {
    addMessage("assistant", analysisData.analysis, {
      id: responseMessageId,
      responseReady: true,
      mentorCards: analysisData.mentorCards,
      structuredContent: analysisData.followUp || null,
    });
    rememberMarketContextForFollowUps(analysisData);
  } else if (
    analysisData &&
    analysisData.analysis &&
    responseType === "proactive_brief"
  ) {
    addMessage("assistant", analysisData.analysis, {
      responseReady: true,
      mentorCards: analysisData.mentorCards,
    });
    rememberMarketContextForFollowUps(analysisData);
  } else if (
    analysisData &&
    analysisData.analysis &&
    responseType === "setup_text"
  ) {
    renderSetupScanCard(analysisData);
    rememberSetupScanForFollowUps(analysisData);
    markLatestScanCard(scanFingerprint);
  } else if (analysisData && analysisData.analysis) {
    addMessage("assistant", analysisData.analysis, { responseReady: true });
    rememberMarketContextForFollowUps(analysisData);
  } else {
    const fallbackText =
      typeof response.data === "string"
        ? response.data
        : response.data?.analysis ||
          "I analyzed the chart but couldn't generate a detailed text report. Try asking a specific question.";
    addMessage(
      "assistant",
      fallbackText,
      responseType === "follow_up_text" || responseType === "question_text"
        ? {
            id: responseMessageId,
            responseReady: true,
            structuredContent: analysisData?.followUp || null,
          }
        : { responseReady: true },
    );
    if (!analysisData) analysisData = { analysis: fallbackText };
    if (!analysisData.analysis) analysisData.analysis = fallbackText;
  }

  if (!isFollowUp && scanFingerprint) {
    markLatestScanCard(scanFingerprint);
  }

  const resolvedSymbol =
    analysisData?.symbol ||
    analysisData?.visualPreflight?.visibleSymbol ||
    chartInfo.symbol ||
    "Unknown";
  const resolvedTimeframe =
    analysisData?.timeframe ||
    analysisData?.visualPreflight?.visibleTimeframe ||
    chartInfo.timeframe ||
    "Unknown";
  state.currentSymbol = resolvedSymbol;
  state.currentTimeframe = resolvedTimeframe;

  if (
    (responseType === "setup_text" || responseType === "question_text") &&
    !isFollowUp &&
    !isChartQualityBlocked &&
    !options?.skipHistory
  ) {
    const historyItem = {
      id:
        options?.requestId ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      requestId: options?.requestId || null,
      timestamp: new Date().toISOString(),
      symbol: resolvedSymbol,
      timeframe: resolvedTimeframe,
      analysis: analysisData?.analysis || "No analysis available",
      signals: analysisData?.signals || [],
      scanOutcome:
        analysisData?.scanOutcome || analysisData?.scan_outcome || null,
      mentorSummary: analysisData?.mentorSummary || null,
      setupGuidance: analysisData?.setupGuidance || null,
      watchCondition: analysisData?.watchCondition || null,
      analysisId: analysisData?.analysisId || response.data?.analysisId || null,
      reviewMode: analysisData?.reviewMode || state.currentReviewMode,
      tradeIdeaStatus: analysisData?.tradeIdeaStatus || "not_found",
      preview:
        (analysisData?.mentorSummary || analysisData?.analysis || "")
          .substring(0, 150)
          .replace(/[#*`]/g, "") || "Chart scan...",
      responseLengthApplied:
        response.data?.responseLengthApplied ||
        state.settings?.responseLength ||
        "standard",
      marketContext:
        response.data?.marketContext || analysisData?.marketContext || null,
      detectedContext: analysisData?.detectedContext || null,
      analysisFocus: analysisData?.analysisFocus || null,
      contextInvalidation: analysisData?.contextInvalidation || null,
      visibleLevels: Array.isArray(analysisData?.visibleLevels)
        ? analysisData.visibleLevels
        : null,
      visualPreflight: analysisData?.visualPreflight || null,
      situationalAwareness: analysisData?.situationalAwareness || null,
      alternateScenario: analysisData?.alternateScenario || null,
      mentorReview:
        typeof normalizeMentorReview === "function"
          ? normalizeMentorReview(analysisData?.mentorReview)
          : null,
      fundamentalBrief: analysisData?.fundamentalBrief || null,
      mentorCards: normalizeMentorCards(analysisData?.mentorCards),
      declaredPlan:
        typeof normalizeStoredDeclaredPlan === "function"
          ? normalizeStoredDeclaredPlan(
              analysisData?.declaredPlan || options?.declaredPlan,
            )
          : null,
      chartFingerprint: scanFingerprint,
      chartFingerprintVersion: CHART_FINGERPRINT_VERSION,
      responseType,
      historyKind: responseType === "question_text" ? "question" : "scan",
      conversationId: ensureCurrentConversationId(options?.conversationId),
      chatMessages:
        responseType === "question_text" ? getPersistableChatMessages() : [],
      chatMessageCount:
        responseType === "question_text"
          ? getPersistableChatMessages().length
          : 0,
    };
    // Mirror the id onto the same analysisData object the just-rendered
    // card's Save button closed over: getScanRequestId() falls back to
    // state.currentHistoryId when analysisData has no id of its own, and
    // that global gets reassigned on every later scan. Without this, an
    // older still-visible card's Save button reads whatever the *newest*
    // scan's id happens to be at click time instead of its own.
    if (
      responseType === "setup_text" &&
      analysisData &&
      typeof analysisData === "object"
    ) {
      analysisData.analysisId = historyItem.id;
    }
    state.currentHistoryId = historyItem.id;
    state.history = [
      historyItem,
      ...state.history.filter(
        (item) => getLocalHistoryItemIdentity(item) !== historyItem.id,
      ),
    ];
    await saveHistory(historyItem);
    if (getPersistableChatMessages().length > 0) {
      await persistVisibleChatToCurrentHistory();
    }
    renderHistory();
    if (terminalSnapshot) {
      terminalSnapshotPersisted = await saveLastViewState(
        historyItem.id,
        terminalSnapshot,
        options?.expectedAuthSubject,
      );
    } else {
      await saveLastViewState(historyItem.id);
    }
  } else if (isFollowUp && !options?.skipHistory) {
    await persistVisibleChatToCurrentHistory();
  }

  if (
    !options?.skipUsage &&
    response.data &&
    (await applyUsagePayload(response.data))
  ) {
    if (getUserTier(state.user) === "free") {
      await checkValueNudgePrompt(state.user.scansUsed, response.data);
    }
  }
  state.currentAnalysis = response.data;
  if (options?.skipHistory && options.historyId) {
    state.currentHistoryId = options.historyId;
  }
  if (isValidConversationUuid(options?.conversationId)) {
    state.currentConversationId = options.conversationId;
  }

  if (responseType === "setup_text" && scanFingerprint && analysisData) {
    rememberLastScanSnapshot({
      fingerprint: scanFingerprint,
      renderType: isChartQualityBlocked ? "chart_quality_blocked" : "setup",
      analysisData: {
        ...(response.data && typeof response.data === "object"
          ? response.data
          : {}),
        ...analysisData,
      },
      historyId: state.currentHistoryId,
    });
  }

  if (options?.isPreviousScan) markVisibleScanAsPreviousScan();

  if (terminalSnapshot) {
    terminalSnapshotPersisted =
      (await saveLastViewState(
        state.currentHistoryId,
        terminalSnapshot,
        options?.expectedAuthSubject,
      )) || terminalSnapshotPersisted;
  }
  return {
    durableRecovery: terminalSnapshot ? terminalSnapshotPersisted : true,
  };
}
