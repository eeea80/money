const ANALYSIS_HISTORY_STORAGE_PREFIX = "analysisHistory";
let activeHistoryStorageKey = null;
let historyLoadGeneration = 0;

/**
 * Decode the authenticated user id only to namespace local extension data.
 * The backend remains the authority for authentication and authorization.
 */
function getHistoryOwnerSubjectFromToken(token) {
  if (!token || typeof token !== "string") return null;

  try {
    const payload = token.split(".")[1];
    if (!payload) return null;

    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedBase64 = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    const decoded = JSON.parse(atob(paddedBase64));
    const subject = typeof decoded.sub === "string" ? decoded.sub.trim() : "";
    return /^[A-Za-z0-9_-]{1,128}$/.test(subject) ? subject : null;
  } catch (error) {
    console.debug("ChartMentor: Unable to scope local account data", error);
    return null;
  }
}

async function getScopedPanelStorageKey(baseKey) {
  const token = await ChartMentorStorage.getAuthToken();
  const subject = getHistoryOwnerSubjectFromToken(token);
  return subject ? `${baseKey}:${subject}` : null;
}

function normalizePanelTabScope(value) {
  return typeof value === "string" && /^tab-\d{1,12}$/.test(value)
    ? value
    : null;
}

async function getScopedPanelStorageKeyForTab(
  baseKey,
  panelTabScope = state.panelTabScope,
) {
  const scope = normalizePanelTabScope(panelTabScope);
  if (!scope) return null;
  const accountKey = await getScopedPanelStorageKey(baseKey);
  return accountKey ? `${accountKey}:${scope}` : null;
}

async function getScopedAnalysisHistoryKey() {
  return getScopedPanelStorageKey(ANALYSIS_HISTORY_STORAGE_PREFIX);
}

function clearHistoryForAccountChange() {
  historyLoadGeneration += 1;
  activeHistoryStorageKey = null;
  state.history = [];
  state.currentConversationId = null;
  renderHistory();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !activeHistoryStorageKey) return;
  const change = changes[activeHistoryStorageKey];
  if (!Array.isArray(change?.newValue)) return;
  if (typeof mergeCanonicalLocalHistory !== "function") return;
  mergeCanonicalLocalHistory(change.newValue);
  renderHistory();
});

function normalizeBackendHistoryItem(raw) {
  const verdict = raw.verdict || null;
  return sanitizeHistoryItemForDisplay({
    id: String(raw.id || raw.analysis_id || Date.now()),
    analysisId:
      raw.analysisId || raw.analysis_id || raw.id
        ? String(raw.analysisId || raw.analysis_id || raw.id)
        : null,
    timestamp: raw.timestamp || raw.created_at || new Date().toISOString(),
    symbol: raw.symbol || "Unknown",
    timeframe: raw.timeframe || "Unknown",
    analysis: raw.analysis_text || raw.analysis || raw.text || "",
    verdict: verdict,
    mistake: raw.mistake || raw.mistakeReason || "",
    explanation: raw.explanation || "",
    action: raw.action || raw.recommendedAction || "",
    psychology: raw.psychology || raw.tradingPsychology || "",
    deepDivePrompts: Array.isArray(raw.deepDivePrompts)
      ? raw.deepDivePrompts
      : [],
    signals: Array.isArray(raw.signals) ? raw.signals : [],
    scanOutcome: raw.scanOutcome || raw.scan_outcome || null,
    mentorSummary: raw.mentorSummary || raw.mentor_summary || null,
    setupGuidance: raw.setupGuidance || raw.setup_guidance || null,
    mentorReview: normalizeMentorReview(
      raw.mentorReview || raw.mentor_review || raw.full_response?.mentorReview,
    ),
    fundamentalBrief:
      raw.fundamentalBrief ||
      raw.fundamental_brief ||
      raw.full_response?.fundamentalBrief ||
      null,
    mentorCards: normalizeMentorCards(
      raw.mentorCards || raw.mentor_cards || raw.full_response?.mentorCards,
    ),
    declaredPlan: normalizeStoredDeclaredPlan(
      raw.declaredPlan || raw.declared_plan || raw.full_response?.declaredPlan,
    ),
    watchCondition: raw.watchCondition || raw.watch_condition || null,
    reviewMode: raw.reviewMode || raw.review_mode || "review",
    tradeIdeaStatus:
      raw.tradeIdeaStatus || raw.trade_idea_status || "not_found",
    preview:
      (raw.mistake || raw.summary || raw.analysis_text || raw.analysis || "")
        .substring(0, 150)
        .replace(/[#*`]/g, "") || "Chart scan...",
    source: "backend",
    responseLengthApplied:
      raw.responseLengthApplied || raw.response_length || "standard",
    responseType:
      raw.responseType ||
      raw.response_type ||
      raw.full_response?.responseType ||
      null,
    historyKind:
      raw.historyKind ||
      raw.history_kind ||
      (raw.full_response?.responseType === "question_text"
        ? "question"
        : "scan"),
    structuredContent:
      raw.structuredContent ||
      raw.structured_content ||
      raw.full_response?.followUp ||
      null,
    chartFingerprint: raw.chartFingerprint || raw.chart_fingerprint || null,
    chartFingerprintVersion:
      raw.chartFingerprintVersion || raw.chart_fingerprint_version || null,
    conversationId:
      raw.conversationId || raw.conversation_id
        ? String(raw.conversationId || raw.conversation_id)
        : null,
    conversationUpdatedAt:
      raw.conversationUpdatedAt || raw.conversation_updated_at || null,
    chatMessages: getPersistableChatMessages(
      raw.chatMessages || raw.chat_messages || [],
    ),
  });
}

/**
 * Find a local history item that likely corresponds to the same analysis as a backend item.
 * Uses symbol + timeframe + preview substring match as the heuristic.
 * Returns the matching local item or null.
 */
function findMatchingLocalItem(backendItem, localItems) {
  const backendAnalysisId =
    backendItem.analysisId || backendItem.analysis_id || null;
  if (!backendAnalysisId) return null;

  return (
    localItems.find((local) => {
      const localAnalysisId = local.analysisId || local.analysis_id || null;
      return (
        localAnalysisId && String(localAnalysisId) === String(backendAnalysisId)
      );
    }) || null
  );
}

/**
 * Merge evaluator metadata from a local item into a backend item when backend is missing that data.
 * Prefers local signals, reviewMode, and tradeIdeaStatus when backend has none.
 */
function mergeLocalEvaluatorFields(backendItem, localItem) {
  const result = { ...backendItem };

  const localHasSignals =
    Array.isArray(localItem.signals) && localItem.signals.length > 0;
  const backendHasSignals =
    Array.isArray(result.signals) && result.signals.length > 0;
  if (localHasSignals && !backendHasSignals) {
    result.signals = localItem.signals;
  }

  const localHasReviewMode =
    localItem.reviewMode && localItem.reviewMode !== "review";
  const backendHasReviewMode =
    result.reviewMode && result.reviewMode !== "review";
  if (localHasReviewMode && !backendHasReviewMode) {
    result.reviewMode = localItem.reviewMode;
  }

  const localHasTradeIdeaStatus =
    localItem.tradeIdeaStatus && localItem.tradeIdeaStatus !== "not_found";
  const backendHasTradeIdeaStatus =
    result.tradeIdeaStatus && result.tradeIdeaStatus !== "not_found";
  if (localHasTradeIdeaStatus && !backendHasTradeIdeaStatus) {
    result.tradeIdeaStatus = localItem.tradeIdeaStatus;
  }

  if (!result.mentorReview && localItem.mentorReview) {
    result.mentorReview = normalizeMentorReview(localItem.mentorReview);
  }
  if (!result.declaredPlan && localItem.declaredPlan) {
    result.declaredPlan = normalizeStoredDeclaredPlan(localItem.declaredPlan);
  }
  if (!result.conversationId && localItem.conversationId) {
    result.conversationId = localItem.conversationId;
  }

  const backendChatMessages = getPersistableChatMessages(result.chatMessages);
  const localChatMessages = getPersistableChatMessages(localItem.chatMessages);
  if (backendChatMessages.length > 0) {
    result.chatMessages = backendChatMessages;
    result.chatMessageCount = backendChatMessages.length;
  } else if (localChatMessages.length > 0) {
    result.chatMessages = localChatMessages;
    result.chatMessageCount = localChatMessages.length;
  }

  return sanitizeHistoryItemForDisplay(result);
}

/**
 * Load history from storage, preferring authenticated backend history when available.
 * When backend rows lack evaluator metadata (signals, reviewMode, tradeIdeaStatus),
 * merge richer data from corresponding local rows using symbol+timeframe+preview matching.
 */
async function loadHistory() {
  const loadGeneration = ++historyLoadGeneration;
  let historyKey = null;

  try {
    historyKey = await getScopedAnalysisHistoryKey();
  } catch (error) {
    console.error("ChartMentor: Error resolving history owner", error);
  }

  if (loadGeneration !== historyLoadGeneration) return;
  activeHistoryStorageKey = historyKey;

  if (!historyKey) {
    state.history = [];
    renderHistory();
    return;
  }

  let localHistory = [];
  try {
    const result = await chrome.storage.local.get([historyKey]);
    if (loadGeneration !== historyLoadGeneration) return;
    localHistory = result[historyKey] || [];
  } catch (error) {
    console.error("ChartMentor: Error loading scoped local history", error);
  }

  if (loadGeneration !== historyLoadGeneration) return;
  const localItems = Array.isArray(localHistory) ? localHistory : [];

  try {
    const response = await chrome.runtime.sendMessage({
      type: "getAnalysisHistory",
    });
    if (loadGeneration !== historyLoadGeneration) return;

    const backendPayload = Array.isArray(response?.data?.history)
      ? response.data.history
      : Array.isArray(response?.data)
        ? response.data
        : [];

    if (response?.success) {
      const backendItems = backendPayload
        .map(normalizeBackendHistoryItem)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      const mergedItems = [];
      const usedLocalIndices = new Set();

      for (const backendItem of backendItems) {
        const localMatch = findMatchingLocalItem(backendItem, localItems);
        if (localMatch) {
          const localIndex = localItems.indexOf(localMatch);
          usedLocalIndices.add(localIndex);
          mergedItems.push(mergeLocalEvaluatorFields(backendItem, localMatch));
        } else {
          mergedItems.push(backendItem);
        }
      }

      const maxItems = 50;
      const resultItems = mergedItems.slice(0, maxItems);
      const unmatchedLocals = localItems
        .filter((_, index) => !usedLocalIndices.has(index))
        .slice(0, 10);

      for (const localItem of unmatchedLocals) {
        if (resultItems.length >= maxItems) break;
        resultItems.push(
          sanitizeHistoryItemForDisplay({ ...localItem, source: "local" }),
        );
      }

      if (loadGeneration !== historyLoadGeneration) return;
      state.history = resultItems;
      renderHistory();
      void flushConversationOutbox();
      return;
    }
  } catch (error) {
    console.error("ChartMentor: Error fetching backend history", error);
  }

  if (loadGeneration !== historyLoadGeneration) return;
  state.history = localItems.map(sanitizeHistoryItemForDisplay);
  renderHistory();
  void flushConversationOutbox();
}

// Simple TTL cache: avoid hitting the backend more than once every 60s
let lastBackendRefresh = 0;
const BACKEND_REFRESH_TTL_MS = 60_000;
let lastCheckoutReturnRefresh = 0;
const CHECKOUT_RETURN_REFRESH_TTL_MS = 5_000;
let lastAccountPageOpenedAt = 0;
const ACCOUNT_RETURN_REFRESH_WINDOW_MS = 5 * 60_000;

/**
 * Refresh user data from backend API
 * This ensures we always have the correct credit count from the server.
 * Uses a 60s TTL to avoid redundant calls on every analysis click.
 */
async function refreshUserDataFromBackend(force = false) {
  if (!(await hasAuthToken())) {
    return;
  }

  const refreshOwnerKey = await getScopedPanelStorageKey("user");
  if (!refreshOwnerKey) return;

  const now = Date.now();
  if (!force && now - lastBackendRefresh < BACKEND_REFRESH_TTL_MS) {
    return; // Recent enough, skip
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: "getUserProfile",
    });

    if (response && response.success && response.data) {
      if ((await getScopedPanelStorageKey("user")) !== refreshOwnerKey) {
        return;
      }
      const profile = response.data;
      hydrateMentorWatchlist(profile.mentorWatchlist);
      const tier = getUserTier(profile);
      state.tradingProfile =
        profile.tradingProfile && typeof profile.tradingProfile === "object"
          ? profile.tradingProfile
          : state.tradingProfile;
      state.user = {
        ...(state.user || {}),
        hasCustomLens: profile.hasCustomLens === true,
      };
      await applyUsagePayload({ ...profile, tier });
      if ((await getScopedPanelStorageKey("user")) !== refreshOwnerKey) {
        return;
      }

      if (["short", "standard", "detailed"].includes(profile.responseLength)) {
        state.settings = {
          ...(state.settings || {}),
          responseLength: profile.responseLength,
        };
      }

      if (
        isMentorVoiceValue(profile.mentorVoice) &&
        (profile.mentorVoiceSelected ||
          !state.settings?.mentorVoiceProfileSelected)
      ) {
        state.settings = {
          ...(state.settings || {}),
          mentorVoice: normalizeMentorVoice(profile.mentorVoice),
        };
      }

      if (
        profile.mentorVoiceSelected === true ||
        !state.settings?.mentorVoiceProfileSelected
      ) {
        state.settings = {
          ...(state.settings || {}),
          mentorVoiceProfileSelected: profile.mentorVoiceSelected,
        };
      }

      if (
        profile.mentorVoicePromptShownAt &&
        typeof profile.mentorVoicePromptShownAt === "string"
      ) {
        state.settings = {
          ...(state.settings || {}),
          mentorVoicePromptShownAt: profile.mentorVoicePromptShownAt,
        };
      }

      if (typeof profile.hasCustomLens === "boolean") {
        state.settings = {
          ...(state.settings || {}),
          hasCustomLens: profile.hasCustomLens,
        };
      }

      if (
        shouldUseIccStarterLens(profile.tradingProfile) &&
        normalizeSetupType(
          state.settings?.setupType || state.currentSetupType,
        ) === "other"
      ) {
        state.settings = {
          ...(state.settings || {}),
          setupType: "icc",
        };
        state.currentSetupType = "icc";
      }

      const backendReviewMode = profile.reviewMode;
      if (isValidReviewMode(backendReviewMode)) {
        const normalizedBackendReviewMode =
          normalizeStoredReviewMode(backendReviewMode);
        state.settings = {
          ...(state.settings || {}),
          reviewMode: normalizedBackendReviewMode,
        };
        state.currentReviewMode = normalizedBackendReviewMode;
        console.log(
          "ChartMentor: Synced reviewMode from backend:",
          backendReviewMode,
        );
      }

      updateReviewModeUI();
      await chrome.storage.local.set({ settings: state.settings });

      lastBackendRefresh = now;
      clearAuthRequiredMessages();
    }
  } catch (error) {
    console.error(
      "ChartMentor: Error refreshing user data from backend",
      error,
    );
  }
}

function hasVisibleUsageGatePrompt() {
  return Boolean(
    state.messages.some(
      (message) => message.isUpgrade && USAGE_GATE_TYPES.has(message.gateType),
    ) || elements.chatMessages?.querySelector("[data-upgrade-gate]"),
  );
}

function hasVisibleConversionPrompt() {
  const hasUpgradeMessage = state.messages.some(
    (message) => message?.isUpgrade || message?.isAuthRequired,
  );
  const hasVisiblePaywall = Boolean(
    elements.paywallOverlay &&
    !elements.paywallOverlay.classList.contains("hidden"),
  );

  return Boolean(
    hasUpgradeMessage || hasVisibleUsageGatePrompt() || hasVisiblePaywall,
  );
}

function refreshUserDataAfterCheckoutReturn() {
  if (!state.isAuthenticated) return;

  const now = Date.now();
  const recentlyOpenedAccount =
    now - lastAccountPageOpenedAt < ACCOUNT_RETURN_REFRESH_WINDOW_MS;
  if (!hasVisibleUsageGatePrompt() && !recentlyOpenedAccount) return;
  if (now - lastCheckoutReturnRefresh < CHECKOUT_RETURN_REFRESH_TTL_MS) return;

  lastCheckoutReturnRefresh = now;
  refreshUserDataFromBackend(true).catch((error) => {
    console.error("ChartMentor: Return profile refresh failed", error);
  });
}

/**
 * Update usage display
 */
function updateUsageDisplay() {
  if (!state.user) {
    state.user = { tier: "free", scansUsed: 0 };
  }

  const tier = getUserTier(state.user);

  if (elements.tierBadge) {
    elements.tierBadge.textContent = !state.isAuthenticated
      ? "Trial"
      : tier === "free"
        ? formatTierLabel(tier)
        : "ChartMentor Infinite";
    const accessLabel = !state.isAuthenticated
      ? "Account required"
      : tier === "free"
        ? "Free access"
        : "ChartMentor Infinite";
    elements.tierBadge.title = accessLabel;
    elements.tierBadge.setAttribute("aria-label", accessLabel);

    // Keep tier badge styling stable
    const tierBackground =
      {
        starter: "linear-gradient(135deg, #3772FF 0%, #06B6D4 100%)",
        pro: "linear-gradient(135deg, #8B5CF6 0%, #06B6D4 100%)",
        elite: "linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)",
        free: "none",
      }[tier] || "none";

    elements.tierBadge.style.background = tierBackground;
    elements.tierBadge.className = `tier-badge tier-${tier}`;
  }

  maybeAddUsageGatePrompt();
}
