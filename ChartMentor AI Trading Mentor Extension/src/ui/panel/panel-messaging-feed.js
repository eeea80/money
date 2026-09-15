function requestScreenshotFromContentScript() {
  return new Promise((resolve) => {
    const requestId = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener("message", handler);
      resolve(value);
    };
    const timeout = setTimeout(() => {
      console.error("ChartMentor: Screenshot request timed out");
      finish(null);
    }, 12000);

    const handler = (event) => {
      // Only accept messages from our parent (the TradingView page running our content script)
      if (event.source !== window.parent) return;
      // Secondary check: messages from our content script always have this source field
      if (event.data?.source !== "chartmentor-content") return;
      if (event.data?.panelToken !== state.panelMessageToken) return;
      if (event.data?.requestId !== requestId) return;
      const msgType = event.data?.type;

      if (msgType === "screenshotCaptured") {
        finish(
          normalizeScreenshotPayload({
            dataUrl: event.data.screenshot || null,
            captureMetadata: event.data.captureMetadata || null,
          }),
        );
      } else if (msgType === "screenshotError") {
        console.error(
          "ChartMentor: Content script screenshot error:",
          event.data.error,
        );
        finish(null);
      }
    };

    window.addEventListener("message", handler);

    // Ask content script to capture the screenshot
    window.parent.postMessage(
      {
        source: "chartmentor-panel",
        type: "captureScreenshot",
        panelToken: state.panelMessageToken,
        payload: { requestId },
      },
      getParentMessageTargetOrigin(),
    );
  });
}

function requestTradingViewAlertDialog(alertLevel) {
  return new Promise((resolve) => {
    const requestId = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", handler);
      resolve({
        opened: result?.opened === true,
        filled: result?.filled === true,
      });
    };
    const timeout = window.setTimeout(
      () => finish({ opened: false, filled: false }),
      3200,
    );

    const handler = (event) => {
      if (event.source !== window.parent) return;
      if (event.data?.source !== "chartmentor-content") return;
      if (event.data?.panelToken !== state.panelMessageToken) return;
      if (event.data?.type !== "alertDialogOpened") return;
      if (event.data?.requestId !== requestId) return;

      finish({
        opened: event.data.success === true,
        filled: event.data.filled === true,
      });
    };

    window.addEventListener("message", handler);
    try {
      window.parent.postMessage(
        {
          source: "chartmentor-panel",
          type: "openTradingViewAlert",
          panelToken: state.panelMessageToken,
          payload: { requestId, level: alertLevel },
        },
        getParentMessageTargetOrigin(),
      );
    } catch (error) {
      console.warn("ChartMentor: Alert bridge request failed", error);
      finish({ opened: false, filled: false });
    }
  });
}

function notifyParentPanelReady() {
  if (!state.panelMessageToken) return;

  try {
    window.parent.postMessage(
      {
        source: "chartmentor-panel",
        type: "panelReady",
        panelToken: state.panelMessageToken,
      },
      getParentMessageTargetOrigin(),
    );
  } catch (error) {
    console.warn("ChartMentor: Failed to notify panel readiness", error);
  }
}

/**
 * Setup message listener from content script
 */
function setupMessageListener() {
  window.addEventListener("message", async (event) => {
    // Only accept messages from parent window (our content script inside TradingView)
    if (
      event.source !== window.parent ||
      event.origin !== getParentMessageTargetOrigin()
    )
      return;
    // Secondary check: our content script always tags messages with this source field
    if (event.data?.source !== "chartmentor-content") return;

    if (event.data?.type === "panelHandshake") {
      if (typeof event.data.panelToken === "string" && event.data.panelToken) {
        state.panelMessageToken = event.data.panelToken;
        state.isRecoveryBoot = Boolean(event.data.isRecovery);
        setPanelTabScopeFromHandshake(event.data.panelTabScope);
        // Do not acknowledge readiness until user/history hydration finishes;
        // an early triggerAnalysis would overwrite the restored review state.
        if (state.panelTabScope && state.bootstrapReady) {
          void restorePanelViewAfterRecovery();
          notifyParentPanelReady();
        }
      }
      return;
    }

    if (
      !state.panelMessageToken ||
      event.data?.panelToken !== state.panelMessageToken
    )
      return;

    const { type, data } = event.data;

    switch (type) {
      case "triggerAnalysis":
        await window.ChartMentorPlanFirst?.requestReview(data?.screenshot);
        break;

      case "updateUser":
        state.user = data.user;
        clearAuthRequiredMessages();
        updateUsageDisplay();
        window.ChartMentorInitiative?.handleProfileUpdate?.();
        void window.ChartMentorSession?.openIfNeeded?.();
        break;

      case "updateTheme":
        document.documentElement.setAttribute("data-theme", data.theme);
        break;

      case "extensionReadiness":
        state.extensionReadiness = normalizeExtensionReadiness(data);
        updateReviewModeUI();
        break;

      case "symbolChanged":
        {
          const sym = normalizePanelText(data?.symbol);
          const tf = normalizePanelText(data?.timeframe);
          const confidence = data?.symbolConfidence || "none";
          const reliable =
            Boolean(sym) &&
            !isPlaceholderSymbol(sym) &&
            (confidence === "high" || confidence === "medium");

          const changed =
            (reliable ? sym : "") !== normalizePanelText(state.currentSymbol) ||
            (reliable ? tf : "") !== normalizePanelText(state.currentTimeframe);
          const nextContextKey = sym ? `${sym}|${tf}` : null;
          const isSettlingPendingContext =
            reliable && state.pendingChartContextKey === nextContextKey;
          if (
            changed &&
            !isSettlingPendingContext &&
            !state.isViewingPreviousScan
          )
            resetPanelForChartContextChange();
          state.pendingChartContextKey = reliable ? null : nextContextKey;
          state.currentSymbol = reliable ? sym : null;
          state.currentTimeframe = reliable ? tf : null;
          state.symbolConfidence = confidence;

          window.ChartMentorPlanFirst?.handleChartContextUpdate?.(data);
          window.ChartMentorInitiative?.handleChartContextUpdate?.(data, { changed });
          window.ChartMentorOutcomePrompts?.handleChartContextUpdate?.(data, { changed });
          if (
            changed &&
            !state.currentAnalysis &&
            state.messages.length === 0
          ) {
            if (!elements.chatMessages?.querySelector(".empty-state")) {
              elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
              renderIdleSuggestionImmediately();
            }
            updateReviewModeUI();
          }
        }
        break;

      case "panelVisibilityChanged":
        state.panelSurfaceVisible = data?.visible === true;
        window.ChartMentorOutcomePrompts?.handlePanelVisibilityChange?.(state.panelSurfaceVisible);
        window.ChartMentorInitiative?.handlePanelVisibilityChange?.(state.panelSurfaceVisible);
        if (state.panelSurfaceVisible) void window.ChartMentorSession?.openIfNeeded?.();
        break;

      case "addMessage":
        addMessage(data.role, data.content);
        break;

      default:
        // Ignore unknown messages silently
        break;
    }
  });
}

/**
 * Switch between tabs.
 *
 * Single source of truth for the tablist contract: the .active class stays the
 * visual driver, and aria-selected plus the roving tabindex are derived from
 * the same condition so the two can never disagree.
 */
function switchTab(tabName) {
  if (state.currentTab === "review" && tabName !== "review") {
    void persistVisibleChatToCurrentHistory();
    void saveLastViewState(state.currentHistoryId);
  }
  // Update state
  state.currentTab = tabName;

  // Update tab buttons
  elements.tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    // Roving tabindex: only the selected tab is a stop in the tab order, so
    // Tab moves out of the tablist instead of walking every tab.
    btn.tabIndex = isActive ? 0 : -1;
  });

  // Update tab panes. Inactive panes are display:none, which keeps their
  // contents out of both the tab order and the accessibility tree.
  elements.tabPanes.forEach((pane) => {
    pane.classList.toggle("active", pane.id === `${tabName}-tab`);
  });
}

/**
 * Left/Right wrap through the tabs, Home/End jump to the ends. Activation
 * follows focus, which matches the click path exactly.
 */
function handleTabListKeydown(event) {
  const tabs = Array.from(
    event.currentTarget.querySelectorAll('[role="tab"]'),
  );
  const current = tabs.indexOf(event.target);
  if (current === -1 || tabs.length === 0) return;

  let next;
  switch (event.key) {
    case "ArrowLeft":
      next = (current - 1 + tabs.length) % tabs.length;
      break;
    case "ArrowRight":
      next = (current + 1) % tabs.length;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = tabs.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  switchTab(tabs[next].dataset.tab);
  tabs[next].focus();
}

function setupTabListKeyboardNavigation() {
  document
    .querySelector('.tab-nav[role="tablist"]')
    ?.addEventListener("keydown", handleTabListKeydown);
}

// This module is also evaluated headlessly by scripts/verify-streaming-recovery.mjs,
// which supplies no document. Guard the registration rather than the browser path.
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", setupTabListKeyboardNavigation);
}

/**
 * Load user data from storage
 */
async function loadUserData() {
  try {
    const authResult = await chrome.storage.local.get([
      STORAGE_KEYS.AUTH_TOKEN,
      STORAGE_KEYS.FIRST_RUN_PENDING,
    ]);
    const authToken = authResult[STORAGE_KEYS.AUTH_TOKEN] || null;
    const authSubject = getHistoryOwnerSubjectFromToken(authToken);
    state.isAuthenticated = Boolean(authSubject);
    state.firstRunPending = authResult[STORAGE_KEYS.FIRST_RUN_PENDING] === true;

    let cachedUser = null;
    if (authSubject) {
      const userStorageKey = await getScopedPanelStorageKey("user");
      if (userStorageKey) {
        const userResult = await chrome.storage.local.get([userStorageKey]);
        const currentToken = await ChartMentorStorage.getAuthToken();
        if (getHistoryOwnerSubjectFromToken(currentToken) !== authSubject) {
          await loadUserData();
          return;
        }
        cachedUser = userResult[userStorageKey] || null;
      }
    }

    state.user = cachedUser || { tier: "free", scansUsed: 0 };
    state.tradingProfile = state.user?.tradingProfile || null;
    updateUsageDisplay();
    if (getUserTier(state.user) !== "free") {
      removeReviewPrompts();
    }

    if (state.isAuthenticated) {
      clearAuthRequiredMessages();
      elements.chatInput.disabled = false;
      elements.sendBtn.disabled = false;
      elements.chatInput.placeholder = getChatInputPlaceholder();

      // Best-effort: sync usage from backend so local storage never blocks incorrectly.
      await refreshUserDataFromBackend();
    } else {
      elements.chatInput.disabled = true;
      elements.sendBtn.disabled = true;
      elements.chatInput.placeholder = getChatInputPlaceholder();
    }
  } catch (error) {
    console.error("ChartMentor: Error loading user data", error);
    state.user = { tier: "free", scansUsed: 0 };
    state.isAuthenticated = false;
  }
}

/**
 * Load settings from storage
 */
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(["settings"]);
    applySettingsState(result.settings || {});
  } catch (error) {
    console.error("ChartMentor: Error loading settings", error);
    applySettingsState(DEFAULT_SETTINGS);
  }

  try {
    await chrome.storage.local.set({ settings: state.settings });
  } catch (error) {
    console.error("ChartMentor: Failed to persist simplified settings", error);
  }

  try {
    const auth = await chrome.storage.local.get(["chartmentor_auth_token"]);
    if (auth.chartmentor_auth_token) {
      const response = await chrome.runtime.sendMessage({
        type: "getUserProfile",
      });
      const backendResponseLength =
        response?.data?.responseLength || response?.responseLength;
      const backendReviewMode =
        response?.data?.reviewMode || response?.reviewMode;
      const backendMentorVoice =
        response?.data?.mentorVoice || response?.mentorVoice;
      const backendMentorVoiceSelected =
        response?.data?.mentorVoiceSelected ?? response?.mentorVoiceSelected;
      const backendMentorVoicePromptShownAt =
        response?.data?.mentorVoicePromptShownAt ||
        response?.mentorVoicePromptShownAt;
      const backendHasCustomLens =
        response?.data?.hasCustomLens ?? response?.hasCustomLens;
      const backendTradingProfile =
        response?.data?.tradingProfile || response?.tradingProfile;
      if (backendTradingProfile && typeof backendTradingProfile === "object") {
        state.tradingProfile = backendTradingProfile;
      }
      if (["short", "standard", "detailed"].includes(backendResponseLength)) {
        state.settings.responseLength = backendResponseLength;
      }
      if (typeof backendHasCustomLens === "boolean") {
        state.settings.hasCustomLens = backendHasCustomLens;
      }
      if (isValidReviewMode(backendReviewMode)) {
        const normalizedBackendReviewMode =
          normalizeStoredReviewMode(backendReviewMode);
        state.settings.reviewMode = normalizedBackendReviewMode;
        state.currentReviewMode = normalizedBackendReviewMode;
      }
      if (
        isMentorVoiceValue(backendMentorVoice) &&
        (backendMentorVoiceSelected ||
          !state.settings?.mentorVoiceProfileSelected)
      ) {
        state.settings.mentorVoice = normalizeMentorVoice(backendMentorVoice);
      }
      if (
        backendMentorVoiceSelected === true ||
        !state.settings?.mentorVoiceProfileSelected
      ) {
        state.settings.mentorVoiceProfileSelected = backendMentorVoiceSelected;
      }
      if (
        backendMentorVoicePromptShownAt &&
        typeof backendMentorVoicePromptShownAt === "string"
      ) {
        state.settings.mentorVoicePromptShownAt =
          backendMentorVoicePromptShownAt;
      }
      await chrome.storage.local.set({ settings: state.settings });
    }
  } catch (error) {
    console.error(
      "ChartMentor: Failed to sync response length from backend",
      error,
    );
  }
}

/**
 * Normalize a backend history item to the panel's history item shape.
 * Handles field name variations and missing fields gracefully.
 */
