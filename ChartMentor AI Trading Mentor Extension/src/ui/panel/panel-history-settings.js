function renderHistory(itemsToRender = null) {
  const items = itemsToRender || state.history;

  if (items.length === 0) {
    elements.historyList.innerHTML = `
      <div class="empty-state">
        <p>${itemsToRender ? "No matching history found." : "No history yet. Your analysis sessions will appear here."}</p>
      </div>
    `;
    return;
  }

  elements.historyList.innerHTML = ""; // Clear previous content

  items.forEach((item) => {
    const historyEl = document.createElement("div");
    historyEl.className = "history-item";
    historyEl.dataset.historyId = item.id;

    const header = document.createElement("div");
    header.className = "history-item-header";

    const symbol = document.createElement("span");
    symbol.className = "history-symbol";
    symbol.textContent = `${item.symbol} `;

    const timeframe = document.createElement("span");
    timeframe.className = "history-tf";
    timeframe.textContent = item.timeframe;
    symbol.appendChild(timeframe);

    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = formatTime(item.timestamp);

    header.appendChild(symbol);
    header.appendChild(time);
    historyEl.appendChild(header);

    const preview = document.createElement("div");
    preview.className = "history-preview";
    preview.textContent = item.preview || "";
    historyEl.appendChild(preview);

    elements.historyList.appendChild(historyEl);
  });
}

/**
 * Format timestamp
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // Less than 24 hours
  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Less than 7 days
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}d ago`;
  }

  return date.toLocaleDateString();
}

/**
 * Save history to storage
 */
function getLocalHistoryItemIdentity(item) {
  const value = item?.analysisId || item?.requestId || item?.id;
  return value === undefined || value === null ? null : String(value);
}

function mergeCanonicalLocalHistory(canonicalHistory) {
  const canonicalById = new Map(
    canonicalHistory
      .map((item) => [getLocalHistoryItemIdentity(item), item])
      .filter(([identity]) => identity),
  );
  const merged = state.history.map((item) => {
    const localItem = canonicalById.get(getLocalHistoryItemIdentity(item));
    if (!localItem) return item;
    canonicalById.delete(getLocalHistoryItemIdentity(item));
    return sanitizeHistoryItemForDisplay({ ...item, ...localItem });
  });
  for (const item of canonicalById.values()) {
    merged.push(sanitizeHistoryItemForDisplay({ ...item, source: "local" }));
  }
  state.history = merged
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
    .slice(0, 50);
}

async function saveHistory(historyItem) {
  const historyKey = activeHistoryStorageKey;
  const identity = getLocalHistoryItemIdentity(historyItem);
  if (!historyKey || !identity) return false;

  try {
    const currentHistoryKey = await getScopedAnalysisHistoryKey();
    if (!currentHistoryKey || currentHistoryKey !== historyKey) {
      console.warn("ChartMentor: Skipped history save after an account change");
      return false;
    }
    const token = await ChartMentorStorage.getAuthToken();
    const expectedAuthSubject = getHistoryOwnerSubjectFromToken(token);
    if (!expectedAuthSubject) return false;
    const response = await chrome.runtime.sendMessage({
      type: "upsertLocalHistoryItem",
      data: { expectedAuthSubject, item: historyItem },
    });
    const latestHistoryKey = await getScopedAnalysisHistoryKey();
    if (latestHistoryKey !== historyKey || !response?.success) return false;
    const canonicalHistory = Array.isArray(response.data?.history)
      ? response.data.history
      : [];
    mergeCanonicalLocalHistory(canonicalHistory);
    return true;
  } catch (error) {
    console.error("ChartMentor: Error saving scoped history", error);
    return false;
  }
}

/**
 * Show/hide loading overlay
 */
function showLoading(show) {
  if (show) {
    startLoadingSequence();
  } else {
    stopLoadingSequence();
  }
}

/**
 * Check if user is authenticated, redirect to signup if not
 */
async function ensureAuthenticated() {
  try {
    const token = await ChartMentorStorage.getAuthToken();
    if (!token) {
      console.log("ChartMentor: Not authenticated, redirecting to auth...");
      window.open(
        buildSignupUrl({ signup_context: "extension_auth_required" }),
        "_blank",
      );
      return false;
    }
    return true;
  } catch (e) {
    if (e.message && e.message.includes("context invalidated")) {
      addMessage(
        "assistant",
        "**Extension update required**: refresh the TradingView page to continue using ChartMentor.",
      );
    }
    return false;
  }
}

/**
 * Open the account page.
 */
async function openSettings() {
  await openAccountUrl(ACCOUNT_URL);
}

async function openAccountUrl(url) {
  if (await ensureAuthenticated()) {
    lastAccountPageOpenedAt = Date.now();
    window.open(url, "_blank");
  }
}

// checkForPendingAnalysis removed (Relying strictly on postMessage from content script to prevent multi-monitor bleed)

/**
 * Clear the current session and start fresh
 */
async function clearSession() {
  if (state.isClearingSession) return;
  state.isClearingSession = true;
  state.scanGeneration += 1;

  try {
    await persistVisibleChatToCurrentHistory({ awaitRemote: true });
    if (state.activeScanRequestId && state.activeScanOwnerSubject) {
      await cancelActiveScanAndClearRecovery();
    } else {
      state.activeScanRequestId = null;
      state.activeScanOwnerSubject = null;
      state.activeScanStorageKeys = null;
      state.isAnalyzing = false;
    }
    await clearCurrentScanRecoveryState();
    await clearLastViewState();
    stopLoadingSequence();

    // Reset state
    state.messages = [];
    state.currentAnalysis = null;
    state.lastScanSnapshot = null;
    state.currentHistoryId = null;
    state.currentConversationId = null;
    state.awaitingSymbolForAnalysis = null;
    state.isViewingPreviousScan = false;

    // Clear UI
    setReviewContentMode(false);
    elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
    renderIdleSuggestion();

    console.log("ChartMentor: Session cleared");
  } finally {
    state.isClearingSession = false;
    updateReviewModeUI();
  }
  if (state.isAuthenticated) {
    await window.ChartMentorSession?.startFresh?.();
  }
}

// Export functions for external access
/**
 * Extract JSON from a string that might contain other text
 */
function extractJson(text) {
  if (!text) return null;
  if (typeof text === "object") return text;

  try {
    // Strategy 1: Direct parse
    return JSON.parse(text);
  } catch (e) {
    // Strategy 2: Extract from markdown code blocks
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (e2) {}
    }

    // Strategy 3: Find first { and last }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(text.substring(start, end + 1));
      } catch (e3) {}
    }
  }
  return null;
}

/**
 * Filter history based on search term
 */
function filterHistory(term) {
  if (!term) {
    renderHistory();
    return;
  }

  const lowerTerm = term.toLowerCase();
  const filtered = state.history.filter(
    (item) =>
      item.symbol.toLowerCase().includes(lowerTerm) ||
      item.timeframe.toLowerCase().includes(lowerTerm) ||
      (item.preview && item.preview.toLowerCase().includes(lowerTerm)),
  );

  renderHistory(filtered);
}

/**
 * Load a specific history item into the active view
 */
function markVisibleScanAsPreviousScan() {
  const card =
    elements.chatMessages?.querySelector(
      ".review-card, .setup-scan-card, .chart-quality-blocked-card",
    ) || elements.chatMessages?.querySelector(".message.assistant:last-child");
  if (!card) return;
  card.classList.add("previous-scan");
  card.dataset.previousScan = "true";
  const kicker = card.querySelector(".scan-result-kicker");
  if (kicker) {
    kicker.textContent = "Previous scan";
    return;
  }
  const content = card.querySelector(".message-content");
  if (!content || content.querySelector(".previous-scan-label")) return;
  const label = document.createElement("div");
  label.className = "previous-scan-label";
  label.textContent = "Previous scan";
  content.prepend(label);
}
