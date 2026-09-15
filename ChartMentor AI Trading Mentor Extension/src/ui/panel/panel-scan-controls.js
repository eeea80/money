// A stuck readiness state is the single hardest thing to diagnose in the wild,
// so each blocking reason keeps its own label instead of collapsing every
// not-ready state into one indistinguishable "Preparing...".
const EXTENSION_READINESS_LABELS = {
  ready: "Ready",
  panel_loading: "Starting ChartMentor...",
  chart_loading: "Waiting for the chart...",
  controls_loading: "Waiting for the TradingView toolbar...",
  extension_loading: "Preparing...",
};

function getExtensionReadinessLabel(ready, reason) {
  if (ready === true) return EXTENSION_READINESS_LABELS.ready;
  return EXTENSION_READINESS_LABELS[reason] || "Preparing...";
}

function normalizeExtensionReadiness(readiness) {
  if (!readiness || typeof readiness !== "object") {
    return {
      ready: false,
      reason: "extension_loading",
      label: EXTENSION_READINESS_LABELS.extension_loading,
    };
  }

  const ready = readiness.ready === true;
  const reason =
    typeof readiness.reason === "string"
      ? readiness.reason
      : "extension_loading";
  return { ready, reason, label: getExtensionReadinessLabel(ready, reason) };
}

function isExtensionReadyForAnalysis() {
  return state.extensionReadiness?.ready === true;
}

function shouldDisableAnalyzeButton() {
  return Boolean(
    state.isAnalyzing ||
      !isExtensionReadyForAnalysis() ||
      !checkScanLimit(),
  );
}

/**
 * Check if user has remaining scans.
 * Tier limits are backend-aligned fallbacks; server usage remains authoritative.
 */
function checkScanLimit() {
  if (!state.isAuthenticated || !state.user) return true;
  if (!hasFreshUserSync(state.user)) return true;

  const creditsRemaining =
    coerceNumber(state.user.creditsRemaining) ??
    coerceNumber(state.user.credits_remaining);
  const dailyCreditsRemaining =
    coerceNumber(state.user.dailyCreditsRemaining) ??
    coerceNumber(state.user.daily_credits_remaining);

  if (creditsRemaining !== null && creditsRemaining <= 0) return false;
  if (dailyCreditsRemaining !== null && dailyCreditsRemaining <= 0) {
    return false;
  }

  return true;
}

function updateReviewModeUI() {
  const modeConfig = getReviewModeConfig();
  const activeMode = normalizeStoredReviewMode(modeConfig.mode);
  syncVisibleEmptyReviewState();
  const repeatCta = "Review another chart";
  const actionLabel =
    !state.isAuthenticated && !state.isAnalyzing
      ? "Create free account"
      : isExtensionReadyForAnalysis() || state.isAnalyzing
        ? state.currentAnalysis && !state.isAnalyzing
          ? repeatCta
          : modeConfig.cta
        : state.extensionReadiness.label;
  if (elements.analyzeBtnLabel) {
    elements.analyzeBtnLabel.textContent = actionLabel;
  }
  if (elements.analyzeBtn && !state.isAnalyzing) {
    elements.analyzeBtn.disabled = state.isAuthenticated
      ? shouldDisableAnalyzeButton()
      : false;
    elements.analyzeBtn.classList.toggle(
      "is-extension-loading",
      state.isAuthenticated && !isExtensionReadyForAnalysis(),
    );
    const accessibleLabel =
      state.isAuthenticated && !isExtensionReadyForAnalysis()
        ? state.extensionReadiness.label || "Preparing ChartMentor..."
        : actionLabel;
    elements.analyzeBtn.title = accessibleLabel;
    elements.analyzeBtn.setAttribute("aria-label", accessibleLabel);
  }
  if (elements.chatInput && !state.awaitingSymbolForAnalysis) {
    elements.chatInput.placeholder = getChatInputPlaceholder(activeMode);
  }
  if (elements.readinessLabel) {
    elements.readinessLabel.textContent = getReadinessCopy();
  }
  if (elements.readinessPill) {
    elements.readinessPill.classList.toggle(
      "ready",
      isExtensionReadyForAnalysis() && !state.isAnalyzing,
    );
    elements.readinessPill.classList.toggle("busy", Boolean(state.isAnalyzing));
  }
  const activationStatus = elements.chatMessages?.querySelector(
    ".activation-status-grid > div:last-child strong",
  );
  if (activationStatus) {
    activationStatus.textContent = getReadinessCopy();
    activationStatus.classList.toggle(
      "status-ready",
      isExtensionReadyForAnalysis() && !state.isAnalyzing,
    );
    activationStatus.classList.toggle(
      "status-muted",
      !isExtensionReadyForAnalysis() || state.isAnalyzing,
    );
  }
}

async function setReviewMode(mode, options = {}) {
  const nextMode = normalizeStoredReviewMode(mode);
  const forceRender = options.forceRender === true;
  if (
    state.isAnalyzing ||
    (nextMode === state.currentReviewMode && !forceRender)
  )
    return;
  const setupType = normalizeSetupType(
    state.currentSetupType || state.settings?.setupType,
  );

  state.settings = {
    ...DEFAULT_SETTINGS,
    ...(state.settings || {}),
    reviewMode: nextMode,
    setupType,
  };
  state.currentReviewMode = nextMode;
  state.currentSetupType = setupType;
  updateReviewModeUI();

  if (forceRender) {
    preserveAndResetActiveConversation();
    state.currentAnalysis = null;
    state.messages = [];
    switchTab("review");
  }

  if (
    (forceRender ||
      (!state.currentAnalysis &&
        state.messages.length === 0 &&
        !isOnboardingVisible())) &&
    elements.chatMessages
  ) {
    setReviewContentMode(false);
    elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
    renderIdleSuggestion();
  }

  try {
    await chrome.storage.local.set({ settings: state.settings });
  } catch (error) {
    console.error("ChartMentor: Failed to persist review mode", error);
  }
}

function applySettingsState(nextSettings) {
  const settings =
    nextSettings && typeof nextSettings === "object" ? nextSettings : {};

  state.settings = {
    ...DEFAULT_SETTINGS,
    ...(state.settings || {}),
    ...settings,
    reviewMode: normalizeStoredReviewMode(
      settings.reviewMode ||
        state.settings?.reviewMode ||
        DEFAULT_SETTINGS.reviewMode,
    ),
    setupType: normalizeSetupType(
      settings.setupType ||
        state.settings?.setupType ||
        DEFAULT_SETTINGS.setupType,
    ),
    hasCustomLens:
      typeof settings.hasCustomLens === "boolean"
        ? settings.hasCustomLens
        : Boolean(state.settings?.hasCustomLens),
    responseLength: ["short", "standard", "detailed"].includes(
      settings.responseLength,
    )
      ? settings.responseLength
      : state.settings?.responseLength || DEFAULT_SETTINGS.responseLength,
    mentorVoice: normalizeMentorVoice(
      settings.mentorVoice || state.settings?.mentorVoice,
    ),
    mentorVoiceProfileSelected: Boolean(
      settings.mentorVoiceProfileSelected ||
      settings.mentorVoiceSelected ||
      state.settings?.mentorVoiceProfileSelected,
    ),
    mentorVoicePromptShownAt:
      settings.mentorVoicePromptShownAt ||
      state.settings?.mentorVoicePromptShownAt ||
      null,
  };

  state.currentReviewMode = normalizeStoredReviewMode(
    state.settings.reviewMode,
  );
  state.currentSetupType = normalizeSetupType(state.settings.setupType);
  if (typeof settings.hasCustomLens === "boolean") {
    state.user = {
      ...(state.user || {}),
      hasCustomLens: settings.hasCustomLens,
    };
  }
  updateReviewModeUI();
}
