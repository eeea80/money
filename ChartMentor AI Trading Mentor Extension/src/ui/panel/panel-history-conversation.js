function renderHistoryConversationStatus(
  text,
  { retry = null, loading = false } = {},
) {
  elements.chatMessages
    ?.querySelector("[data-conversation-load-status]")
    ?.remove();
  if (!text || !elements.chatMessages) return;
  const status = document.createElement("div");
  status.className = "conversation-load-status";
  status.classList.toggle("is-loading", loading);
  status.dataset.conversationLoadStatus = "true";
  status.setAttribute("role", retry ? "alert" : "status");
  const label = document.createElement("span");
  label.textContent = text;
  status.appendChild(label);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-load-retry";
    button.textContent = "Retry";
    button.addEventListener("click", retry);
    status.appendChild(button);
  }
  elements.chatMessages.appendChild(status);
}

function isQuestionHistoryItem(item) {
  return (
    item?.historyKind === "question" || item?.responseType === "question_text"
  );
}

function setHistoryConversationLoading(isLoading, loadGeneration) {
  if (
    !isLoading &&
    Number.isInteger(loadGeneration) &&
    loadGeneration !== state.conversationLoadGeneration
  ) return;
  state.isConversationLoading = isLoading;
  if (elements.sendBtn) {
    elements.sendBtn.disabled =
      isLoading || state.isAnalyzing || state.isSubmittingMessage;
  }
}

function renderHistoryItemSurface(item, analysisData, chatMessages, options) {
  state.messages = [];
  state.awaitingSymbolForAnalysis = null;
  elements.chatMessages.innerHTML = "";
  setReviewContentMode(true);
  const isQuestion = isQuestionHistoryItem(item);
  if (!isQuestion) {
    renderSetupScanCard(analysisData);
    markLatestScanCard(item.chartFingerprint);
    if (options.isPreviousScan) markVisibleScanAsPreviousScan();
    rememberSetupScanForFollowUps(analysisData);
  } else {
    rememberMarketContextForFollowUps(analysisData);
  }
  const restoredMessages =
    isQuestion && chatMessages.length === 0 && analysisData.analysis
      ? [
          {
            id: createConversationUuid(),
            role: "assistant",
            content: analysisData.analysis,
            structuredContent: item.structuredContent || null,
            timestamp: item.timestamp,
            remoteSynced: true,
          },
        ]
      : chatMessages;
  restorePersistedChatMessages(restoredMessages, { full: true });
  rememberLastScanSnapshot({
    fingerprint: item.chartFingerprint,
    renderType: isQuestion ? "question" : "setup",
    analysisData,
    historyId: item.id,
  });
}

async function loadHistoryItem(id, options = {}) {
  if (state.isAnalyzing) return;
  const rawItem = state.history.find((item) => String(item.id) === String(id));
  if (!rawItem) {
    console.error("ChartMentor: History item not found", id);
    return;
  }
  const item = sanitizeHistoryItemForDisplay(rawItem);
  const loadGeneration = ++state.conversationLoadGeneration;
  setHistoryConversationLoading(true, loadGeneration);
  try {
  switchTab("review");

  if (!options.preserveChartContext) {
    state.currentSymbol = item.symbol;
    state.currentTimeframe = item.timeframe;
  }
  state.currentAnalysis = item;
  state.currentHistoryId = item.id;
  state.currentConversationId = isValidConversationUuid(item.conversationId)
    ? item.conversationId
    : null;
  state.isViewingPreviousScan = Boolean(options.isPreviousScan);
  state.lastScanSnapshot = null;

  const analysisData = {
    analysis: item.analysis || "",
    signals: item.signals || [],
    scanOutcome: item.scanOutcome || item.scan_outcome || null,
    mentorSummary: item.mentorSummary || item.mentor_summary || null,
    setupGuidance: item.setupGuidance || item.setup_guidance || null,
    mentorReview: normalizeMentorReview(
      item.mentorReview || item.mentor_review,
    ),
    fundamentalBrief:
      item.fundamentalBrief || item.fundamental_brief || null,
    mentorCards: normalizeMentorCards(item.mentorCards || item.mentor_cards),
    declaredPlan: normalizeStoredDeclaredPlan(
      item.declaredPlan || item.declared_plan,
    ),
    watchCondition: item.watchCondition || item.watch_condition || null,
    analysisId: item.analysisId || item.analysis_id || null,
    reviewMode: item.reviewMode || "review",
    marketContext: item.marketContext || item.market_context || null,
    detectedContext: item.detectedContext || item.detected_context || null,
    analysisFocus: item.analysisFocus || item.analysis_focus || null,
    contextInvalidation:
      item.contextInvalidation || item.context_invalidation || null,
    visibleLevels: Array.isArray(item.visibleLevels || item.visible_levels)
      ? item.visibleLevels || item.visible_levels
      : null,
    visualPreflight: item.visualPreflight || item.visual_preflight || null,
    situationalAwareness:
      item.situationalAwareness || item.situational_awareness || null,
    alternateScenario:
      item.alternateScenario || item.alternate_scenario || null,
    followUp: item.structuredContent || null,
    symbol: item.symbol,
    timeframe: item.timeframe,
  };
  const localMessages = getPersistableChatMessages(item.chatMessages);
  renderHistoryItemSurface(item, analysisData, localMessages, options);
  await saveLastViewState(item.id);

  if (!state.currentConversationId) {
    if (localMessages.length > 0) {
      renderHistoryConversationStatus(
        "This older conversation is available from this browser's recovery cache only.",
      );
    }
    return;
  }

  renderHistoryConversationStatus("Loading the complete conversation...", {
    loading: true,
  });
  let durable;
  try {
    durable = await loadDurableConversation(state.currentConversationId);
  } catch (error) {
    durable = {
      success: false,
      messages: [],
      incomplete: true,
      error: "The complete conversation could not be loaded.",
    };
    console.debug("ChartMentor: Conversation load failed", error);
  }
  if (
    loadGeneration !== state.conversationLoadGeneration ||
    String(state.currentHistoryId) !== String(item.id)
  ) {
    return;
  }

  const liveLocalMessages = getPersistableChatMessages();
  const mergedMessages = mergeDurableConversationMessages(
    durable.messages,
    liveLocalMessages,
  );
  renderHistoryItemSurface(item, analysisData, mergedMessages, options);
  item.chatMessages = getPersistableChatMessages(mergedMessages);
  item.chatMessageCount = mergedMessages.length;
  item.conversationSyncPending = mergedMessages.some(
    (message) => message.remoteSynced !== true,
  );
  await saveHistory(item);

  if (!durable.success || durable.incomplete) {
    renderHistoryConversationStatus(
      durable.error ||
        "Only part of this conversation could be loaded. Your local recovery copy is still shown.",
      { retry: () => void loadHistoryItem(item.id, options) },
    );
  }
  if (item.conversationSyncPending) {
    const recovered = await saveCurrentConversationMessages(mergedMessages, {
      historyId: item.id,
      historyItem: item,
      conversationId: state.currentConversationId,
    });
    if (recovered && !durable.success) {
      renderHistoryConversationStatus("");
    }
  }
  await saveLastViewState(item.id);
  } catch (error) {
    console.debug("ChartMentor: History conversation render failed", error);
    if (loadGeneration === state.conversationLoadGeneration) {
      renderHistoryConversationStatus(
        "This conversation could not be restored. Your saved history is unchanged.",
        { retry: () => void loadHistoryItem(item.id, options) },
      );
    }
  } finally {
    setHistoryConversationLoading(false, loadGeneration);
  }
}
