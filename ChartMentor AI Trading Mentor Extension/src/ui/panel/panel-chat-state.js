function normalizePersistedChatMessage(message) {
  if (!isPersistableChatMessage(message)) return null;

  return {
    id: ensureConversationMessageId(message),
    role: message.role,
    content: message.content.trim().slice(0, 12_000),
    rawText: Boolean(message.rawText),
    mentorCards: normalizeMentorCards(message.mentorCards),
    structuredContent: cloneConversationStructuredContent(
      message.structuredContent,
    ),
    timestamp: message.timestamp || new Date().toISOString(),
    remoteSynced: message.remoteSynced === true,
  };
}

function getPersistableChatMessages(messages = state.messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .map(normalizePersistedChatMessage)
    .filter(Boolean)
    .slice(-MAX_PERSISTED_CHAT_MESSAGES);
}

function prefersReducedMotion() {
  return Boolean(
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}

function renderIdleSuggestion() {
  if (
    !state.isAnalyzing &&
    !state.currentAnalysis &&
    Array.isArray(state.messages) &&
    state.messages.length === 0 &&
    elements.chatMessages &&
    elements.chatMessages.children.length === 0
  ) {
    setReviewContentMode(false);
    elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
  }
}

function renderIdleSuggestionImmediately() {
  renderIdleSuggestion();
}

async function persistVisibleChatToCurrentHistory({ awaitRemote = false } = {}) {
  const historyId = state.currentHistoryId;
  if (!historyId) return false;

  const historyIndex = state.history.findIndex(
    (item) => String(item.id) === String(historyId),
  );
  if (historyIndex === -1) return false;

  const chatMessages = getPersistableChatMessages().map((message) => ({
    ...message,
  }));
  if (chatMessages.length === 0) return false;
  const conversationId = ensureCurrentConversationId(
    state.history[historyIndex].conversationId,
  );

  const updatedHistoryItem = {
    ...state.history[historyIndex],
    conversationId,
    chatMessages,
    chatMessageCount: chatMessages.length,
    conversationSyncPending: chatMessages.some(
      (message) => message.remoteSynced !== true,
    ),
    updatedAt: new Date().toISOString(),
  };
  state.history[historyIndex] = updatedHistoryItem;

  await saveHistory(updatedHistoryItem);
  const remoteSave = saveCurrentConversationMessages(chatMessages, {
    historyId,
    historyItem: updatedHistoryItem,
    conversationId,
  });
  const reportRemoteResult = (remotelySaved) => {
    if (!remotelySaved) {
      console.debug(
        "ChartMentor: Conversation remains in the local recovery outbox",
      );
    }
    return remotelySaved;
  };
  if (awaitRemote) {
    try {
      reportRemoteResult(await remoteSave);
    } catch (error) {
      console.debug("ChartMentor: Conversation remote save failed", error);
    }
  } else {
    void remoteSave.then(reportRemoteResult).catch((error) => {
      console.debug("ChartMentor: Conversation remote save failed", error);
    });
  }
  renderHistory();
  return true;
}

function formatFundamentalBriefForFollowUp(brief) {
  if (!brief || typeof brief !== "object") return "";
  const drivers = Array.isArray(brief.drivers)
    ? brief.drivers
        .map((item) => normalizePanelText(item))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  return [
    brief.bias
      ? `Current fundamental bias: ${normalizePanelText(brief.bias)}`
      : null,
    drivers.length ? `Drivers: ${drivers.join(" | ")}` : null,
    brief.counterRisk
      ? `Counter-risk: ${normalizePanelText(brief.counterRisk)}`
      : null,
    brief.nextCatalyst?.title
      ? `Next catalyst: ${normalizePanelText(brief.nextCatalyst.title)}`
      : null,
    brief.asOf ? `As of: ${normalizePanelText(brief.asOf)}` : null,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1200);
}

function rememberMarketContextForFollowUps(analysisData) {
  const marketContext =
    analysisData?.marketContext || analysisData?.market_context || null;
  const marketContextSummary =
    typeof marketContext?.summary === "string"
      ? marketContext.summary.slice(0, 1200)
      : "";
  const fundamentalContext = formatFundamentalBriefForFollowUp(
    analysisData?.fundamentalBrief || analysisData?.fundamental_brief,
  );
  if ((!marketContextSummary && !fundamentalContext) || analysisData?.verdict)
    return;

  state.messages.push({
    id: `market-context-${Date.now()}`,
    role: "assistant",
    content: [
      "Previous ChartMentor market context:",
      marketContextSummary || null,
      fundamentalContext || null,
    ]
      .filter(Boolean)
      .join("\n"),
    hiddenContext: true,
    timestamp: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
}

function rememberSetupScanForFollowUps(analysisData) {
  if (!analysisData?.analysis || analysisData?.verdict) return;

  const marketContext =
    analysisData.marketContext || analysisData.market_context || null;
  const marketContextSummary =
    typeof marketContext?.summary === "string"
      ? marketContext.summary.slice(0, 1200)
      : "";
  const fundamentalContext = formatFundamentalBriefForFollowUp(
    analysisData.fundamentalBrief || analysisData.fundamental_brief,
  );
  const signals = Array.isArray(analysisData.signals)
    ? analysisData.signals
    : [];
  const mentorReviewContext =
    typeof formatMentorReviewForFollowUp === "function"
      ? formatMentorReviewForFollowUp(analysisData.mentorReview)
      : "";
  const declaredPlan =
    typeof normalizeStoredDeclaredPlan === "function"
      ? normalizeStoredDeclaredPlan(analysisData.declaredPlan)
      : null;
  const declaredPlanContext = declaredPlan
    ? [
        `Declared plan: ${declaredPlan.direction} (${declaredPlan.source})`,
        declaredPlan.entry ? `entry ${declaredPlan.entry}` : null,
        declaredPlan.stop ? `stop ${declaredPlan.stop}` : null,
        declaredPlan.target ? `target ${declaredPlan.target}` : null,
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  const signalLines = signals.slice(0, 3).map((signal, index) => {
    const parts = [
      `Setup ${index + 1}: ${signal.direction || "N/A"}`,
      signal.entry ? `entry ${signal.entry}` : null,
      signal.stopLoss ? `stop ${signal.stopLoss}` : null,
      signal.takeProfit ? `target ${signal.takeProfit}` : null,
      signal.riskReward ? `R/R ${signal.riskReward}` : null,
      Number.isFinite(Number(signal.confidence))
        ? `confidence ${signal.confidence}%`
        : null,
    ].filter(Boolean);
    return parts.join(", ");
  });

  const contextLines = [
    "Previous ChartMentor setup scan context:",
    analysisData.symbol ? `Symbol: ${analysisData.symbol}` : null,
    analysisData.timeframe ? `Timeframe: ${analysisData.timeframe}` : null,
    analysisData.scanOutcome || analysisData.scan_outcome
      ? `Scan outcome: ${analysisData.scanOutcome || analysisData.scan_outcome}`
      : null,
    `Setup scan: ${analysisData.analysis}`,
    declaredPlanContext || null,
    mentorReviewContext || null,
    signalLines.length
      ? `Structured signals:\n${signalLines.join("\n")}`
      : null,
    marketContextSummary
      ? `External market context used:\n${marketContextSummary}`
      : null,
    fundamentalContext || null,
  ]
    .filter(Boolean)
    .join("\n");

  state.messages.push({
    id: `setup-context-${Date.now()}`,
    role: "assistant",
    content: contextLines.slice(0, 4000),
    hiddenContext: true,
    timestamp: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
}

function formatTierLabel(userProfile) {
  const tier =
    typeof userProfile === "string"
      ? normalizeTier(userProfile)
      : getUserTier(userProfile);
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function hasUsagePayload(payload) {
  if (!payload || typeof payload !== "object") return false;

  return [
    "creditsRemaining",
    "credits_remaining",
    "dailyCreditsRemaining",
    "daily_credits_remaining",
    "monthlyLimit",
    "monthly_limit",
    "planTier",
    "plan_tier",
    "subscriptionStatus",
    "subscription_status",
  ].some((key) => typeof payload[key] !== "undefined");
}

async function applyUsagePayload(payload) {
  if (!hasUsagePayload(payload)) return false;

  const userStorageKey = await getScopedPanelStorageKey("user");
  if (!userStorageKey) return false;

  const tier = normalizeTier(
    payload.planTier ||
      payload.plan_tier ||
      payload.subscriptionStatus ||
      payload.subscription_status ||
      state.user?.tier ||
      state.user?.planTier ||
      "free",
  );
  const existingMonthlyLimit = getMonthlyScanLimit({
    ...(state.user || {}),
    tier,
  });
  const monthlyLimit =
    coerceNumber(payload.monthlyLimit) ??
    coerceNumber(payload.monthly_limit) ??
    existingMonthlyLimit;
  const creditsRemaining =
    coerceNumber(payload.creditsRemaining) ??
    coerceNumber(payload.credits_remaining) ??
    coerceNumber(state.user?.creditsRemaining) ??
    coerceNumber(state.user?.credits_remaining);
  const dailyCreditsRemaining =
    coerceNumber(payload.dailyCreditsRemaining) ??
    coerceNumber(payload.daily_credits_remaining) ??
    coerceNumber(state.user?.dailyCreditsRemaining) ??
    coerceNumber(state.user?.daily_credits_remaining);
  const scansUsed =
    creditsRemaining !== null
      ? Math.max(0, Math.min(monthlyLimit, monthlyLimit - creditsRemaining))
      : (coerceNumber(payload.scansUsed) ??
        coerceNumber(payload.scans_used) ??
        coerceNumber(state.user?.scansUsed) ??
        0);

  const currentUserStorageKey = await getScopedPanelStorageKey("user");
  if (currentUserStorageKey !== userStorageKey) return false;

  state.user = {
    ...state.user,
    ...payload,
    tier,
    monthlyLimit,
    scansUsed,
    creditsRemaining,
    dailyCreditsRemaining,
    lastSync: new Date().toISOString(),
  };

  await chrome.storage.local.set({ [userStorageKey]: state.user });
  updateUsageDisplay();
  if (getUserTier(state.user) !== "free") {
    removeReviewPrompts();
  }
  return true;
}
