const ACTIVE_SCAN_STORAGE_PREFIX = "activeScanInProgress";
const ACTIVE_SCAN_MARKER_MAX_AGE_MS = 5 * 60 * 1000;
const SCAN_RESULT_STORAGE_PREFIX = "scanResultReady";
const SCAN_RESULT_RECOVERY_WAIT_MS = 170 * 1000;

function createScanRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function getCurrentScanStorageKeys() {
  const [activeKey, resultKey] = await Promise.all([
    getScopedPanelStorageKeyForTab(ACTIVE_SCAN_STORAGE_PREFIX),
    getScopedPanelStorageKeyForTab(SCAN_RESULT_STORAGE_PREFIX),
  ]);
  return { activeKey, resultKey };
}

async function markScanInProgress(requestId, activeKey, ownerSubject = null) {
  try {
    if (!activeKey) return false;
    await chrome.storage.local.set({
      [activeKey]: {
        startedAt: Date.now(),
        requestId,
        ownerSubject,
        phase: "preparing",
      },
    });
    return true;
  } catch (error) {
    console.debug("ChartMentor: Failed to save active-scan marker", error);
    return false;
  }
}

async function attachScanContext(requestId, activeKey, context) {
  try {
    if (!activeKey) return false;
    const stored = await chrome.storage.local.get([activeKey]);
    const marker = stored[activeKey];
    if (!marker || marker.requestId !== requestId) return false;
    await chrome.storage.local.set({
      [activeKey]: {
        ...marker,
        ...context,
        phase: "submitted",
        submittedAt: Date.now(),
      },
    });
    return true;
  } catch (error) {
    console.debug("ChartMentor: Failed to attach scan context", error);
    return false;
  }
}

async function clearScanInProgressMarker(requestId, scanStorageKeys = {}) {
  try {
    const keys = [scanStorageKeys.activeKey, scanStorageKeys.resultKey].filter(
      Boolean,
    );
    if (!requestId || keys.length === 0) return;
    const stored = await chrome.storage.local.get(keys);
    const matchingKeys = keys.filter(
      (key) => stored[key]?.requestId === requestId,
    );
    if (matchingKeys.length) await chrome.storage.local.remove(matchingKeys);
  } catch (error) {
    console.debug("ChartMentor: Failed to clear active-scan marker", error);
  }
}

function waitForScanResultInStorage(resultKey, requestId, timeoutMs) {
  if (!resultKey || timeoutMs <= 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(listener);
      resolve(value);
    };

    const listener = (changes, areaName) => {
      if (areaName !== "local" || !changes[resultKey]) return;
      const value = changes[resultKey].newValue;
      if (value?.requestId === requestId) finish(value);
    };

    chrome.storage.onChanged.addListener(listener);
    const timer = setTimeout(() => finish(null), timeoutMs);
    chrome.storage.local
      .get([resultKey])
      .then((stored) => {
        const value = stored[resultKey];
        if (value?.requestId === requestId) finish(value);
      })
      .catch(() => finish(null));
  });
}

async function cancelActiveScanAndClearRecovery(
  requestId = state.activeScanRequestId,
  ownerSubject = state.activeScanOwnerSubject,
) {
  if (!requestId || !ownerSubject) return false;
  const scanStorageKeys =
    state.activeScanStorageKeys || (await getCurrentScanStorageKeys());
  if (state.activeScanRequestId === requestId) {
    state.activeScanRequestId = null;
    state.activeScanOwnerSubject = null;
    state.activeScanStorageKeys = null;
    state.activeScanIsProactive = false;
    state.isAnalyzing = false;
  }

  try {
    await chrome.runtime.sendMessage({
      type: "cancelAnalyzeChart",
      data: {
        requestId,
        expectedAuthSubject: ownerSubject,
      },
    });
  } catch (error) {
    console.debug("ChartMentor: Failed to cancel active scan", error);
  }
  await clearScanInProgressMarker(requestId, scanStorageKeys);
  void refreshUserDataFromBackend(true);
  return true;
}

async function clearCurrentScanRecoveryState() {
  const scanStorageKeys = await getCurrentScanStorageKeys();
  const keys = [scanStorageKeys.activeKey, scanStorageKeys.resultKey].filter(
    Boolean,
  );
  if (!keys.length) return;
  const stored = await chrome.storage.local.get(keys);
  const requestIds = new Set(
    keys
      .map((key) => stored[key]?.requestId)
      .filter(
        (requestId) =>
          typeof requestId === "string" &&
          /^[A-Za-z0-9_-]{8,160}$/.test(requestId),
      ),
  );
  for (const requestId of requestIds) {
    await clearScanInProgressMarker(requestId, scanStorageKeys);
  }
}

async function reportInterruptedScanIfAny() {
  let recoveredRequestId = null;
  try {
    const scanStorageKeys = await getCurrentScanStorageKeys();
    const { activeKey, resultKey } = scanStorageKeys;
    if (!activeKey) return false;
    const stored = await chrome.storage.local.get(
      resultKey ? [activeKey, resultKey] : [activeKey],
    );
    const marker = stored[activeKey];
    if (!marker?.startedAt) {
      if (resultKey && stored[resultKey]) {
        await chrome.storage.local.remove([resultKey]);
      }
      return false;
    }

    let resolved =
      resultKey && stored[resultKey]?.requestId === marker.requestId
        ? stored[resultKey]
        : null;

    const age = Date.now() - marker.startedAt;
    if (!resolved && age > ACTIVE_SCAN_MARKER_MAX_AGE_MS) {
      await clearScanInProgressMarker(marker.requestId, scanStorageKeys);
      return false;
    }

    if (!marker.submittedAt && !marker.chartInfo) {
      await clearScanInProgressMarker(marker.requestId, scanStorageKeys);
      return false;
    }

    if (!resolved && resultKey) {
      recoveredRequestId = marker.requestId;
      state.isAnalyzing = true;
      state.activeScanRequestId = marker.requestId;
      state.activeScanOwnerSubject = marker.ownerSubject || null;
      state.activeScanStorageKeys = scanStorageKeys;
      switchTab("review");
      showLoading(true);
      showAnalysisTypingBubble();
      resolved = await waitForScanResultInStorage(
        resultKey,
        marker.requestId,
        Math.min(
          ACTIVE_SCAN_MARKER_MAX_AGE_MS - age,
          SCAN_RESULT_RECOVERY_WAIT_MS,
        ),
      );
    }

    if (resolved?.result?.success) {
      const lastView = await getLastViewState();
      if (lastView?.terminalScan?.requestId === marker.requestId) {
        const restored = await restoreTerminalScanView(lastView, {
          forcePreviousScan: !state.isRecoveryBoot,
        });
        if (restored) {
          await clearScanInProgressMarker(marker.requestId, scanStorageKeys);
          return true;
        }
      }

      state.currentReviewMode =
        marker.activeReviewMode || state.currentReviewMode;
      switchTab("review");
      const visibleContext = {
        symbol: state.currentSymbol,
        timeframe: state.currentTimeframe,
        symbolConfidence: state.symbolConfidence,
      };
      const recoveredSymbol = normalizePanelText(marker.chartInfo?.symbol);
      const recoveredTimeframe = normalizePanelText(
        marker.chartInfo?.timeframe,
      );
      const isPreviousScan = Boolean(
        !state.isRecoveryBoot ||
        (visibleContext.symbol &&
          recoveredSymbol &&
          (visibleContext.symbol !== recoveredSymbol ||
            (visibleContext.timeframe &&
              recoveredTimeframe &&
              visibleContext.timeframe !== recoveredTimeframe))),
      );
      state.isViewingPreviousScan = isPreviousScan;
      const handoff = await processAnalysisResponse(
        resolved.result,
        Boolean(marker.isFollowUp),
        marker.activeReviewMode,
        marker.scanFingerprint || null,
        marker.chartInfo || { symbol: "Unknown", timeframe: "Unknown" },
        { dataUrl: null, captureMetadata: null },
        { dataUrl: null, captureMetadata: null },
        {
          isPreviousScan,
          requestId: marker.requestId,
          expectedAuthSubject: marker.ownerSubject || null,
          declaredPlan: marker.declaredPlan || null,
        },
      );
      if (isPreviousScan) {
        state.currentSymbol = visibleContext.symbol;
        state.currentTimeframe = visibleContext.timeframe;
        state.symbolConfidence = visibleContext.symbolConfidence;
      }
      if (handoff?.durableRecovery === true) {
        await clearScanInProgressMarker(marker.requestId, scanStorageKeys);
      }
      return true;
    }

    await clearScanInProgressMarker(marker.requestId, scanStorageKeys);
    showLoading(false);
    addMessage(
      "assistant",
      resolved?.result?.error ||
        "The panel had to reload mid-scan, so that scan didn't come through. Run it again.",
      { isAnalysisError: true },
    );
    return true;
  } catch (error) {
    console.debug(
      "ChartMentor: Failed to check interrupted-scan marker",
      error,
    );
    return false;
  } finally {
    const ownsRecoveryState = Boolean(
      recoveredRequestId && state.activeScanRequestId === recoveredRequestId,
    );
    if (ownsRecoveryState) {
      state.activeScanRequestId = null;
      state.activeScanOwnerSubject = null;
      state.activeScanStorageKeys = null;
    }
    if (ownsRecoveryState && state.isAnalyzing) {
      state.isAnalyzing = false;
      showLoading(false);
      updateReviewModeUI();
      if (elements.analyzeBtn) {
        elements.analyzeBtn.classList.remove("analyzing");
        elements.analyzeBtn.disabled = shouldDisableAnalyzeButton();
      }
    }
  }
}
