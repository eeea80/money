const PANEL_LAST_VIEW_STORAGE_PREFIX = "panelLastView";
const PANEL_LAST_VIEW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const TERMINAL_SCAN_TEXT_MAX_CHARS = 30000;

function isValidTerminalScanRequestId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(value);
}

function cloneTerminalScanValue(value, depth = 0) {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string")
    return value.slice(0, TERMINAL_SCAN_TEXT_MAX_CHARS);
  if (depth >= 8 || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => cloneTerminalScanValue(item, depth + 1));
  }

  const cloned = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(screenshot|image|dataurl)/i.test(key)) continue;
    const nextValue = cloneTerminalScanValue(item, depth + 1);
    if (nextValue !== null) cloned[key] = nextValue;
  }
  return cloned;
}

function createTerminalScanSnapshot({
  requestId,
  response,
  isFollowUp,
  activeReviewMode,
  scanFingerprint,
  chartInfo,
  isPreviousScan,
  expectedAuthSubject,
  declaredPlan,
  conversationId,
  responseMessageId,
}) {
  if (!isValidTerminalScanRequestId(requestId)) return null;
  const safeResponse = cloneTerminalScanValue(response);
  if (!safeResponse || typeof safeResponse !== "object") return null;
  return {
    requestId,
    response: safeResponse,
    isFollowUp: Boolean(isFollowUp),
    activeReviewMode: normalizeStoredReviewMode(activeReviewMode),
    scanFingerprint:
      typeof scanFingerprint === "string" ? scanFingerprint : null,
    chartInfo: cloneTerminalScanValue(chartInfo) || {
      symbol: "Unknown",
      timeframe: "Unknown",
    },
    isPreviousScan: Boolean(isPreviousScan),
    ownerSubject:
      typeof expectedAuthSubject === "string" ? expectedAuthSubject : null,
    declaredPlan: cloneTerminalScanValue(declaredPlan),
    conversationId: isValidConversationUuid(conversationId)
      ? conversationId
      : null,
    responseMessageId: isValidConversationUuid(responseMessageId)
      ? responseMessageId
      : null,
  };
}

async function getLastViewState() {
  const key = await getScopedPanelStorageKeyForTab(
    PANEL_LAST_VIEW_STORAGE_PREFIX,
  );
  if (!key) return null;
  const stored = await chrome.storage.local.get([key]);
  const lastView = stored[key];
  if (
    !lastView ||
    Date.now() - (lastView.savedAt || 0) > PANEL_LAST_VIEW_MAX_AGE_MS
  )
    return null;
  return lastView;
}

async function saveLastViewState(
  historyId,
  terminalScan = null,
  expectedAuthSubject = null,
) {
  try {
    if (expectedAuthSubject) {
      const token = await ChartMentorStorage.getAuthToken();
      if (getHistoryOwnerSubjectFromToken(token) !== expectedAuthSubject) {
        return false;
      }
    }
    const key = await getScopedPanelStorageKeyForTab(
      PANEL_LAST_VIEW_STORAGE_PREFIX,
    );
    if (!key) return false;
    await chrome.storage.local.set({
      [key]: {
        historyId: historyId || null,
        conversationId: isValidConversationUuid(state.currentConversationId)
          ? state.currentConversationId
          : null,
        terminalScan: terminalScan || null,
        savedAt: Date.now(),
      },
    });
    return true;
  } catch (error) {
    console.debug("ChartMentor: Failed to save panel last-view state", error);
    return false;
  }
}

async function clearLastViewState() {
  try {
    const key = await getScopedPanelStorageKeyForTab(
      PANEL_LAST_VIEW_STORAGE_PREFIX,
    );
    if (key) await chrome.storage.local.remove([key]);
  } catch (error) {
    console.debug("ChartMentor: Failed to clear panel last-view state", error);
  }
}

async function restoreTerminalScanView(
  lastView,
  { forcePreviousScan = false } = {},
) {
  const snapshot = lastView?.terminalScan;
  if (!snapshot || !isValidTerminalScanRequestId(snapshot.requestId))
    return false;
  if (!snapshot.response || typeof snapshot.response !== "object") return false;

  const visibleContext = {
    symbol: state.currentSymbol,
    timeframe: state.currentTimeframe,
    symbolConfidence: state.symbolConfidence,
  };
  const scannedSymbol = normalizePanelText(snapshot.chartInfo?.symbol);
  const scannedTimeframe = normalizePanelText(snapshot.chartInfo?.timeframe);
  const isPreviousScan = Boolean(
    forcePreviousScan ||
    snapshot.isPreviousScan ||
    (visibleContext.symbol &&
      scannedSymbol &&
      (visibleContext.symbol !== scannedSymbol ||
        (visibleContext.timeframe &&
          scannedTimeframe &&
          visibleContext.timeframe !== scannedTimeframe))),
  );

  state.isViewingPreviousScan = isPreviousScan;
  await processAnalysisResponse(
    snapshot.response,
    snapshot.isFollowUp,
    snapshot.activeReviewMode,
    snapshot.scanFingerprint,
    snapshot.chartInfo || { symbol: "Unknown", timeframe: "Unknown" },
    { dataUrl: null, captureMetadata: null },
    { dataUrl: null, captureMetadata: null },
    {
      isPreviousScan,
      requestId: snapshot.requestId,
      skipHistory: true,
      skipUsage: true,
      skipTerminalSnapshot: true,
      historyId: lastView.historyId || null,
      expectedAuthSubject: snapshot.ownerSubject || null,
      declaredPlan: snapshot.declaredPlan || null,
      conversationId:
        snapshot.conversationId || lastView.conversationId || null,
      responseMessageId: snapshot.responseMessageId || null,
    },
  );
  if (isPreviousScan) {
    state.currentSymbol = visibleContext.symbol;
    state.currentTimeframe = visibleContext.timeframe;
    state.symbolConfidence = visibleContext.symbolConfidence;
  }
  return true;
}

async function restorePanelViewAfterRecovery() {
  if (state.recoveryRestoreDone) return;
  state.recoveryRestoreDone = true;
  const scanWasRecovered = await reportInterruptedScanIfAny();
  if (scanWasRecovered) return;

  try {
    const lastView = await getLastViewState();
    if (!lastView) return;
    state.currentConversationId = isValidConversationUuid(
      lastView.conversationId,
    )
      ? lastView.conversationId
      : null;
    const forcePreviousScan = !state.isRecoveryBoot;
    const terminalRestored = await restoreTerminalScanView(lastView, {
      forcePreviousScan,
    });
    if (terminalRestored) {
      const terminalHistoryItem = lastView.historyId
        ? state.history.find(
            (historyItem) =>
              String(historyItem.id) === String(lastView.historyId),
          )
        : null;
      if (terminalHistoryItem) {
        await persistVisibleChatToCurrentHistory();
        await loadHistoryItem(lastView.historyId, {
          preserveChartContext: state.isViewingPreviousScan,
          isPreviousScan: state.isViewingPreviousScan,
        });
      }
      return;
    }
    if (!lastView.historyId) return;

    const item = state.history.find(
      (historyItem) =>
        historyItem.id.toString() === lastView.historyId.toString(),
    );
    if (!item) return;

    const currentSymbol = normalizePanelText(state.currentSymbol);
    const currentTimeframe = normalizePanelText(state.currentTimeframe);
    const isPreviousScan = Boolean(
      forcePreviousScan ||
      (currentSymbol &&
        (currentSymbol !== normalizePanelText(item.symbol) ||
          (currentTimeframe &&
            normalizePanelText(item.timeframe) &&
            currentTimeframe !== normalizePanelText(item.timeframe)))),
    );
    await loadHistoryItem(lastView.historyId, {
      preserveChartContext: isPreviousScan,
      isPreviousScan,
    });
  } catch (error) {
    console.debug(
      "ChartMentor: Failed to restore panel last-view state",
      error,
    );
  }
}
