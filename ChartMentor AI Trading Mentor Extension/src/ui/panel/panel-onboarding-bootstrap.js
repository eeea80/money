function handleLocalStorageChange(changes, areaName) {
  if (areaName !== "local") return;

  if (changes.settings?.newValue) {
    const previousReviewMode = normalizeStoredReviewMode(
      state.currentReviewMode,
    );
    const previousSetupType = normalizeSetupType(state.currentSetupType);
    applySettingsState(changes.settings.newValue);

    const reviewModeChanged = previousReviewMode !== state.currentReviewMode;
    const setupTypeChanged = previousSetupType !== state.currentSetupType;
    if (
      (reviewModeChanged || setupTypeChanged) &&
      !state.isAnalyzing &&
      state.messages.length === 0 &&
      !isOnboardingVisible()
    ) {
      setReviewContentMode(false);
      elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
      renderIdleSuggestion();
    }
  }

  if (changes.user?.newValue) {
    state.user = {
      ...(state.user || {}),
      ...changes.user.newValue,
    };
    updateUsageDisplay();
  }

  if (
    Object.prototype.hasOwnProperty.call(
      changes,
      STORAGE_KEYS.FIRST_RUN_PENDING,
    )
  ) {
    state.firstRunPending =
      changes[STORAGE_KEYS.FIRST_RUN_PENDING]?.newValue === true;
  }

  const authTokenChange = changes[STORAGE_KEYS.AUTH_TOKEN];
  if (authTokenChange) {
    const previousSubject = getHistoryOwnerSubjectFromToken(
      authTokenChange.oldValue,
    );
    const nextSubject = getHistoryOwnerSubjectFromToken(
      authTokenChange.newValue,
    );
    const accountChanged = previousSubject !== nextSubject;
    state.isAuthenticated = Boolean(nextSubject);

    if (accountChanged) {
      state.scanGeneration += 1;
      if (state.activeScanRequestId && state.activeScanOwnerSubject) {
        void cancelActiveScanAndClearRecovery();
      } else {
        state.isAnalyzing = false;
      }
      showLoading(false);
      state.user = null;
      state.tradingProfile = null;
      lastBackendRefresh = 0;
      resetPanelForChartContextChange({
        preserveInFlightScan: false,
        forceReset: true,
      });
      clearHistoryForAccountChange();
      loadHistory().catch((error) => {
        console.error("ChartMentor: Account history reload failed", error);
      });
    }

    if (state.isAuthenticated) {
      clearAuthRequiredMessages();
      if (elements.chatInput) {
        elements.chatInput.disabled = false;
        elements.chatInput.placeholder = getChatInputPlaceholder();
      }
      if (elements.sendBtn) {
        elements.sendBtn.disabled = false;
      }
      refreshUserDataFromBackend(true).catch((error) => {
        console.error("ChartMentor: Auth sync profile refresh failed", error);
      });
      window.ChartMentorInitiative?.handleProfileUpdate?.();
      void window.ChartMentorSession?.openIfNeeded?.();
    } else {
      if (elements.chatInput) {
        elements.chatInput.disabled = true;
        elements.chatInput.placeholder = getChatInputPlaceholder();
      }
      if (elements.sendBtn) {
        elements.sendBtn.disabled = true;
      }
    }

    updateUsageDisplay();
    updateReviewModeUI();
  }
}

async function shouldShowExtensionOnboarding() {
  if (!state.isAuthenticated) return false;

  try {
    return (
      (await ChartMentorStorage.get(EXTENSION_ONBOARDING_COMPLETE_KEY)) !== true
    );
  } catch (error) {
    console.warn("ChartMentor: Failed to read onboarding state", error);
    return false;
  }
}

async function clearFirstRunPending() {
  if (!state.firstRunPending) return;
  state.firstRunPending = false;
  try {
    await ChartMentorStorage.set(STORAGE_KEYS.FIRST_RUN_PENDING, false);
  } catch (error) {
    console.warn("ChartMentor: Failed to clear first-run state", error);
  }
}

async function markExtensionOnboardingComplete() {
  try {
    await ChartMentorStorage.set(EXTENSION_ONBOARDING_COMPLETE_KEY, true);
  } catch (error) {
    console.warn("ChartMentor: Failed to save onboarding state", error);
  }
}

async function hydrateCurrentChartContext() {
  try {
    const chartInfo = await getChartInfo();
    if (!chartInfo || isPlaceholderSymbol(chartInfo.symbol)) return;

    state.currentSymbol = normalizePanelText(chartInfo.symbol);
    state.currentTimeframe = normalizePanelText(chartInfo.timeframe);
    state.symbolConfidence = chartInfo.symbolConfidence || null;
    window.ChartMentorPlanFirst?.handleChartContextUpdate?.(chartInfo);
  } catch (error) {
    // The panel can still open without a TradingView tab or content script.
    console.debug("ChartMentor: Initial chart context unavailable", error);
  }
}

function clearPendingSymbolSelection() {
  if (!state.awaitingSymbolForAnalysis) return;

  state.awaitingSymbolForAnalysis = null;
  state.messages = state.messages.filter(
    (message) => !message.isSymbolClarification,
  );
  elements.chatMessages
    ?.querySelectorAll('[data-symbol-clarification="true"]')
    .forEach((messageEl) => messageEl.remove());
}

function preserveInFlightScanUiOnChartChange() {
  if (!elements.chatMessages) return;
  const retainedBubble = document.getElementById("chartmentor-typing-bubble");

  setReviewContentMode(true);
  elements.chatMessages.replaceChildren();
  if (retainedBubble) {
    elements.chatMessages.appendChild(retainedBubble);
  } else {
    showAnalysisTypingBubble();
  }

  const bubble = document.getElementById("chartmentor-typing-bubble");
  if (bubble) {
    let contextNote = bubble.querySelector(".inflight-scan-context-note");
    if (!contextNote) {
      contextNote = document.createElement("div");
      contextNote.className = "inflight-scan-context-note";
      bubble.querySelector(".message-content")?.prepend(contextNote);
    }
    contextNote.textContent =
      "Chart changed — finishing your previous chart scan";
  }
  scrollReviewToEnd();
}

function resetPanelForChartContextChange({
  preserveInFlightScan = state.isAnalyzing,
  forceReset = false,
} = {}) {
  if (
    !forceReset &&
    window.ChartMentorSession?.shouldPreserveOnChartChange?.()
  ) {
    state.chartContextRevision += 1;
    return;
  }
  if (state.activeScanIsProactive) {
    void cancelActiveScanAndClearRecovery();
    preserveInFlightScan = false;
    showLoading(false);
  }
  const shouldPreserveInFlightScan =
    preserveInFlightScan === true && state.isAnalyzing === true;
  preserveAndResetActiveConversation();
  state.chartContextRevision += 1;
  state.isViewingPreviousScan = false;
  state.messages = [];
  state.currentAnalysis = null;
  state.lastScanSnapshot = null;
  clearPendingSymbolSelection();

  if (shouldPreserveInFlightScan) {
    preserveInFlightScanUiOnChartChange();
  } else if (elements.chatMessages) {
    setReviewContentMode(false);
    elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
    renderIdleSuggestionImmediately();
  }
  updateReviewModeUI();
}

async function syncCurrentChartContext() {
  const chartInfo = await getChartInfo();
  const symbol = normalizePanelText(chartInfo?.symbol);
  const timeframe = normalizePanelText(chartInfo?.timeframe);
  const confidence = chartInfo?.symbolConfidence || "none";
  const symbolIsReliable =
    Boolean(symbol) &&
    !isPlaceholderSymbol(symbol) &&
    (confidence === "high" || confidence === "medium");

  if (!symbolIsReliable) {
    // A single unreliable read can happen transiently - e.g. the chart tab
    // is a backgrounded browser tab and its response to our chart-info
    // request is delayed, so we fall back to a lower-confidence URL-derived
    // read - even though the chart context hasn't actually changed. Require
    // a couple of consecutive unreliable polls before treating the context
    // as genuinely lost, so a momentary blip (most visible right when
    // switching browser tabs) doesn't wipe an already-rendered scan.
    state.unreliableChartContextStreak += 1;
    if (state.unreliableChartContextStreak < 2) return;

    const hadContext = Boolean(state.currentSymbol || state.currentTimeframe);
    if (hadContext && !state.isViewingPreviousScan)
      resetPanelForChartContextChange();
    state.pendingChartContextKey = symbol ? `${symbol}|${timeframe}` : null;
    state.currentSymbol = null;
    state.currentTimeframe = null;
    state.symbolConfidence = confidence;
    if (hadContext && !state.currentAnalysis && state.messages.length === 0) {
      if (!elements.chatMessages.querySelector(".empty-state")) {
        elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
        renderIdleSuggestionImmediately();
      }
      updateReviewModeUI();
    }
    return;
  }

  state.unreliableChartContextStreak = 0;

  const contextChanged =
    symbol !== normalizePanelText(state.currentSymbol) ||
    timeframe !== normalizePanelText(state.currentTimeframe);
  const nextContextKey = `${symbol}|${timeframe}`;
  const isSettlingPendingContext =
    state.pendingChartContextKey === nextContextKey;

  if (
    contextChanged &&
    !isSettlingPendingContext &&
    !state.isViewingPreviousScan
  )
    resetPanelForChartContextChange();
  state.pendingChartContextKey = null;

  if (!contextChanged && confidence === state.symbolConfidence) return;

  state.currentSymbol = symbol;
  state.currentTimeframe = timeframe;
  state.symbolConfidence = confidence;
  if (!state.currentAnalysis && state.messages.length === 0) {
    if (!elements.chatMessages.querySelector(".empty-state")) {
      elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
      renderIdleSuggestionImmediately();
    }
    updateReviewModeUI();
  }
}

function startChartContextMonitor() {
  if (state.chartContextMonitorId) return;

  state.chartContextMonitorId = window.setInterval(() => {
    syncCurrentChartContext().catch((error) => {
      console.debug("ChartMentor: Chart context refresh unavailable", error);
    });
  }, 2000);
}

async function renderInitialReviewState() {
  if (!elements.chatMessages || state.messages.length > 0) return;
  if (state.isAnalyzing) {
    setReviewContentMode(true);
    elements.chatMessages.replaceChildren();
    showAnalysisTypingBubble();
    return;
  }
  setReviewContentMode(false);
  elements.chatMessages.innerHTML = getEmptyReviewStateHtml({
    showOnboarding: await shouldShowExtensionOnboarding(),
  });
  renderIdleSuggestion();
}

async function dismissExtensionOnboarding() {
  const onboardingIsVisible = isOnboardingVisible();

  if (onboardingIsVisible && state.messages.length === 0) {
    setReviewContentMode(false);
    elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
    renderIdleSuggestion();
  }

  await clearFirstRunPending();
  if (onboardingIsVisible || state.isAuthenticated) {
    await markExtensionOnboardingComplete();
  }
}

async function switchToSetupScanFromFallback() {
  if (state.isAnalyzing) return;

  if (isOnboardingVisible()) {
    await dismissExtensionOnboarding();
  }

  await setReviewMode("signal_generator", { forceRender: true });
  if (isExtensionReadyForAnalysis()) {
    await window.ChartMentorPlanFirst?.requestReview();
  }
}

async function handleOnboardingAction(event) {
  const onboardingButton = event.target.closest("[data-onboarding-action]");
  const fallbackButton = event.target.closest("[data-fallback-action]");

  if (!onboardingButton && !fallbackButton) return;

  event.preventDefault();

  if (onboardingButton) {
    await dismissExtensionOnboarding();
    return;
  }

  if (fallbackButton?.dataset.fallbackAction === "switch-to-scan") {
    await switchToSetupScanFromFallback();
    return;
  }
}

// Initialize Panel
document.addEventListener("DOMContentLoaded", async () => {
  console.log("ChartMentor Panel: Initializing...");

  // Cache DOM elements
  cacheElements();

  // Keep shell interactions available while profile/history hydration runs.
  setupEventListeners();

  // Listen for toolbar-triggered analysis before async profile/history loading.
  setupMessageListener();

  // Load user data
  await loadUserData();

  // Load settings
  await loadSettings();

  // Load history
  await loadHistory();

  await hydrateCurrentChartContext();
  await renderInitialReviewState();

  // If this boot is a mid-session iframe rebuild rather than a normal
  // first open, restore whatever history item was showing. Must run after
  // renderInitialReviewState(), which would otherwise overwrite the
  // restored scan card with the empty/idle state for history items that
  // have no follow-up chat messages of their own.
  //
  // state.isRecoveryBoot is set asynchronously by the panelHandshake
  // message, which can arrive before or after this point depending on load
  // timing. bootstrapReady flags that history/state are ready so the
  // handshake handler can safely trigger the restore itself if the
  // handshake arrives after this check already ran.
  state.bootstrapReady = true;
  if (state.panelTabScope) {
    await restorePanelViewAfterRecovery();
  }
  startChartContextMonitor();
  await window.ChartMentorSession?.openIfNeeded?.();
  window.ChartMentorInitiative?.handleProfileUpdate?.();

  notifyParentPanelReady();
  console.log("ChartMentor Panel: Ready");
});

/**
 * Cache DOM elements for performance
 */
function cacheElements() {
  elements.tabButtons = document.querySelectorAll(".tab-btn");
  elements.tabPanes = document.querySelectorAll(".tab-pane");
  elements.chatMessages = document.getElementById("chat-messages");
  elements.chatInput = document.getElementById("chat-input");
  elements.sendBtn = document.getElementById("send-btn");
  elements.historyList = document.getElementById("history-list");
  elements.historySearch = document.getElementById("history-search");
  elements.analyzeBtn = document.getElementById("analyze-btn");
  elements.analyzeBtnLabel = document.getElementById("analyze-btn-label");
  elements.usageInfo = document.getElementById("usage-info");
  elements.tierBadge = document.getElementById("tier-badge");
  elements.readinessPill = document.getElementById("readiness-pill");
  elements.readinessLabel = document.getElementById("readiness-label");
  elements.readinessDot = document.getElementById("readiness-dot");
  elements.settingsBtn = document.getElementById("settings-btn");
  elements.newSessionBtn = document.getElementById("new-session-btn");
  elements.hintButtons = document.querySelectorAll(".hint-btn");
  elements.paywallOverlay = document.getElementById("paywall-overlay");
  elements.updateBanner = document.getElementById("update-banner");
  elements.updateBannerDismiss = document.getElementById(
    "update-banner-dismiss",
  );
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Tab switching
  elements.tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Chat input
  elements.chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Send button
  elements.sendBtn.addEventListener("click", sendMessage);

  // Plan-first primary action. Generic chart scans are intentionally not a
  // visible entry point in mentor mode.
  elements.analyzeBtn.addEventListener("click", () => {
    void window.ChartMentorPlanFirst?.requestReview();
  });

  // Settings button
  elements.settingsBtn.addEventListener("click", openSettings);

  // New Session button
  if (elements.newSessionBtn) {
    elements.newSessionBtn.addEventListener("click", clearSession);
  }

  if (elements.chatMessages) {
    elements.chatMessages.addEventListener("click", handleOnboardingAction);
  }

  // Update banner dismiss
  if (elements.updateBannerDismiss) {
    elements.updateBannerDismiss.addEventListener("click", () => {
      state.updateBannerDismissed = true;
      applyUpdateBannerState(false);
    });
  }

  // Close button
  elements.closePanelBtn = document.getElementById("close-panel-btn");
  elements.closePanelBtn.addEventListener("click", () => {
    window.parent.postMessage(
      {
        source: "chartmentor-panel",
        type: "closePanel",
        panelToken: state.panelMessageToken,
      },
      getParentMessageTargetOrigin(),
    );
  });

  // Hint buttons
  elements.hintButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      elements.chatInput.value = btn.dataset.hint;
      elements.chatInput.focus();
    });
  });

  // History search
  if (elements.historySearch) {
    elements.historySearch.addEventListener("input", (e) => {
      filterHistory(e.target.value);
    });
  }

  // Paywall buttons
  const paywallUpgradeBtn = document.getElementById("paywall-upgrade-btn");
  if (paywallUpgradeBtn) {
    paywallUpgradeBtn.addEventListener("click", () => {
      const gate = getCurrentUsageGate();
      const gateType = gate?.gateType || "monthly-hard";
      const config = getGateUIConfig(gateType);
      if (gateType === "safety-hard") {
        void trackPanelEvent("safety_pause_account_opened", {
          source: "extension_paywall_overlay",
        });
        window.open(config.upgradeUrl, "_blank");
        return;
      }
      trackPanelEvent("upgrade_cta_clicked", {
        source: "extension_paywall_overlay",
        gateType,
      });
      void startDollarTrialCheckoutFromPanel({
        button: paywallUpgradeBtn,
        gateType,
        source: "extension_paywall_overlay",
        fallbackUrl: config.upgradeUrl,
      });
    });
  }

  const paywallCloseBtn = document.getElementById("paywall-close-btn");
  if (paywallCloseBtn) {
    paywallCloseBtn.addEventListener("click", () => {
      const gate = getCurrentUsageGate();
      state.paywallDismissed = true;
      hidePaywallOverlay();
      if (
        gate?.gateType === "monthly-hard" ||
        gate?.gateType === "daily-hard" ||
        gate?.gateType === "safety-hard"
      ) {
        const config = getGateUIConfig(gate.gateType);
        addUpgradePrompt(gate.limitType, {
          gateType: gate.gateType,
          content: config.description,
          ctaLabel: config.buttonText,
          upgradeUrl: config.upgradeUrl,
        });
      }
    });
  }

  // History item clicks
  if (elements.historyList) {
    elements.historyList.addEventListener("click", (e) => {
      const item = e.target.closest(".history-item");
      if (item) {
        loadHistoryItem(item.dataset.historyId);
      }
    });
  }

  chrome.storage.onChanged.addListener(handleLocalStorageChange);
  window.addEventListener("focus", refreshUserDataAfterCheckoutReturn);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshUserDataAfterCheckoutReturn();
    }
  });
}

/**
 * Request a screenshot from the content script (which has the correct tab context)
 * This avoids the sender.tab issue when calling captureVisibleTab from an iframe.
 */
