function restoreEmptyReviewStateAfterGateRemoval() {
  if (
    !elements.chatMessages ||
    state.currentAnalysis ||
    state.messages.length > 0 ||
    isOnboardingVisible()
  )
    return;

  setReviewContentMode(false);
  elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
  renderIdleSuggestionImmediately();
}

/**
 * Counts how many of the user's own recent scans came back Watch Trigger or
 * No Clean Trigger - i.e. setups ChartMentor kept them from forcing. Reads
 * from the same locally-synced history the panel already renders, so this
 * needs no extra network call and degrades to "no personalization" (null)
 * for new accounts with no history yet.
 */
function getScanOutcomeCounts() {
  const counts = { signal: 0, watch: 0, noTrigger: 0 };
  for (const item of state.history || []) {
    const outcome = String(item?.scanOutcome || "").toUpperCase();
    if (outcome === "SIGNAL") counts.signal++;
    else if (outcome === "WATCH_TRIGGER") counts.watch++;
    else if (outcome === "NO_CLEAN_TRIGGER") counts.noTrigger++;
  }
  return counts;
}

function getAvoidedSetupsBlurb() {
  const { noTrigger, watch } = getScanOutcomeCounts();
  const avoided = noTrigger + watch;
  if (avoided <= 0) return null;

  const noun = avoided === 1 ? "setup" : "setups";
  const detail =
    noTrigger > 0 && watch > 0
      ? `${noTrigger} skipped and ${watch} flagged to watch instead of forced`
      : noTrigger > 0
        ? `${noTrigger} skipped instead of forced`
        : `${watch} flagged to watch instead of forced`;
  return `Your Strategy Lens has already kept you out of ${avoided} weak ${noun} (${detail}).`;
}

function getGateUIConfig(gateType = "monthly-hard") {
  const isDaily = gateType === "daily-hard";
  const isSafetyPause = gateType === "safety-hard";
  const tier = getUserTier(state.user);
  const isFreeTier = tier === "free";
  const nextTier = getNextUpgradeTier(tier);
  const nextTierDisplay = nextTier ? getTierDisplayLabel(nextTier) : null;

  let title = "";
  let description = "";
  let buttonText = nextTierDisplay ? "Keep it on" : "Open account";
  let checkoutSource = isDaily
    ? "extension_daily_gate"
    : "extension_hard_gate";
  let upgradeUrl = nextTier
    ? getExtensionPricingUrl(
        isDaily ? "extension_daily_gate" : "extension_hard_gate",
        tier,
      )
    : ACCOUNT_URL;

  const avoidedBlurb = nextTierDisplay ? getAvoidedSetupsBlurb() : null;

  if (isSafetyPause) {
    title = "High-volume safety pause";
    description =
      "ChartMentor Infinite paused after unusually high automated activity. Try again later, or open your account if this looks wrong.";
    buttonText = "Open account";
    checkoutSource = "extension_safety_gate";
    upgradeUrl = ACCOUNT_URL;
  } else if (isFreeTier && isDollarTrialTreatmentOffer()) {
    title = "$1 today. Seven days of Pro.";
    description =
      "Start seven days of Pro for $1 today. Then $39.99/month unless canceled. Your one free lifetime review remains available with no card.";
    buttonText = "Start 7-Day Pro for $1";
  } else if (isDaily) {
    title = "Usage finished for today";
    if (!nextTierDisplay) {
      description =
        "That is all for today. Come back tomorrow, or open your account if this looks wrong.";
    } else {
      description = `You are out for today. Upgrade to ${nextTierDisplay} for a larger analysis allowance and keep reviewing charts now. Otherwise come back tomorrow.`;
      if (avoidedBlurb) description = `${avoidedBlurb} ${description}`;
    }
  } else if (isFreeTier) {
    // Free is a lifetime cap with no reset - "this period"/"next reset"
    // language (still correct for paid tiers' monthly soft caps below)
    // would falsely tell a free user more scans are coming without upgrading.
    title = "Your free plan review has been used";
    description = `Free includes one lifetime plan review. Upgrade to ${nextTierDisplay || "Pro"} to keep reviewing plans.`;
    if (avoidedBlurb) description = `${avoidedBlurb} ${description}`;
  } else {
    title = "Usage finished for this period";
    if (!nextTierDisplay) {
      description =
        "You have used the included usage for this period. New scans unlock at your next reset; open your account if this looks wrong.";
    } else {
      description = `You have used the included usage for this period. Upgrade to ${nextTierDisplay} for a larger analysis allowance and more chart reviews before your next reset.`;
      if (avoidedBlurb) description = `${avoidedBlurb} ${description}`;
    }
  }

  return { title, description, buttonText, upgradeUrl, checkoutSource };
}

function showBlockedReviewPaywall(usageGate) {
  if (
    usageGate?.gateType === "monthly-hard" &&
    isDollarTrialTreatmentOffer()
  ) {
    void trackPanelEvent("limit_reached", {
      source: "extension_second_review_attempt",
      limitType: "monthly",
      experiment: "dollar_trial_v1",
      variant: "dollar_trial",
    });
  }
  showPaywallOverlay(usageGate?.gateType || "monthly-hard");
}

function showPaywallOverlay(gateType) {
  if (state.paywallDismissed) return;
  removeReviewPrompts();
  if (!elements.paywallOverlay) {
    elements.paywallOverlay = document.getElementById("paywall-overlay");
  }
  if (elements.paywallOverlay) {
    const config = getGateUIConfig(gateType);
    const titleEl = elements.paywallOverlay.querySelector(".paywall-title");
    if (titleEl) {
      titleEl.textContent = config.title;
    }
    const descEl = document.getElementById("paywall-description");
    if (descEl) {
      descEl.textContent = config.description;
    }
    const upgradeBtn = document.getElementById("paywall-upgrade-btn");
    if (upgradeBtn) {
      upgradeBtn.textContent = config.buttonText;
    }
    if (isDollarTrialTreatmentOffer()) {
      trackDollarTrialOfferShownFromPanel(config.checkoutSource);
    }
    elements.paywallOverlay.classList.remove("hidden");
    elements.paywallOverlay.setAttribute("aria-hidden", "false");
  }
}

function hidePaywallOverlay() {
  if (!elements.paywallOverlay) {
    elements.paywallOverlay = document.getElementById("paywall-overlay");
  }
  if (elements.paywallOverlay) {
    elements.paywallOverlay.classList.add("hidden");
    elements.paywallOverlay.setAttribute("aria-hidden", "true");
  }
}

function maybeAddUsageGatePrompt() {
  const gate = getCurrentUsageGate();

  if (!gate) {
    state.paywallDismissed = false; // Reset dismissal state
    hidePaywallOverlay();
    const removedGate = removeUsageGatePrompts();
    if (removedGate) {
      restoreEmptyReviewStateAfterGateRemoval();
    } else {
      renderIdleSuggestion();
    }
    return;
  }

  if (
    gate.gateType === "monthly-hard" ||
    gate.gateType === "daily-hard" ||
    gate.gateType === "safety-hard"
  ) {
    removeUsageGatePrompts(["monthly-soft"]);
    showPaywallOverlay(gate.gateType);
    return;
  }

  if (gate.gateType === "monthly-soft") {
    hidePaywallOverlay();
    const tier = getUserTier(state.user);
    const nextTier = getNextUpgradeTier(tier);
    if (!nextTier) {
      const removedGate = removeUsageGatePrompts(["monthly-soft"]);
      if (removedGate) {
        restoreEmptyReviewStateAfterGateRemoval();
      } else {
        renderIdleSuggestion();
      }
      return;
    }

    const nextTierDisplay = getTierDisplayLabel(nextTier);
    const upgradeUrl = getExtensionPricingUrl(
      "extension_soft_gate",
      tier,
    );
    const avoidedBlurb = getAvoidedSetupsBlurb();
    // Free never resets, so "for this period" would be misleading there;
    // paid tiers' soft cap does reset monthly, so that framing stays for them.
    const usageAlmostGoneCopy =
      tier === "free"
        ? "Your one free lifetime review is still available with no card."
        : "Your usage is almost finished for this period.";
    const softGateIntro = avoidedBlurb
      ? `${avoidedBlurb} ${usageAlmostGoneCopy}`
      : usageAlmostGoneCopy;

    addUpgradePrompt("monthly", {
      gateType: "monthly-soft",
      content:
        tier === "free" && isDollarTrialTreatmentOffer()
          ? `${softGateIntro}\nOr start seven days of Pro for $1 today. Then $39.99/month unless canceled.`
          : `${softGateIntro}\nWant me beside every setup? Upgrade to ${nextTierDisplay}.`,
      ctaLabel:
        tier === "free" && isDollarTrialTreatmentOffer()
          ? "Start 7-Day Pro for $1"
          : "Keep ChartMentor on",
      upgradeUrl,
      checkoutSource: "extension_soft_gate",
    });
    return;
  }

  hidePaywallOverlay();
  addUpgradePrompt(gate.limitType, {
    gateType: gate.gateType,
    upgradeUrl: getExtensionPricingUrl(
      gate.gateType === "daily-hard"
        ? "extension_daily_gate"
        : "extension_hard_gate",
      state.user?.tier,
    ),
    checkoutSource:
      gate.gateType === "daily-hard"
        ? "extension_daily_gate"
        : "extension_hard_gate",
  });
}

/**
 * Add a limit or near-limit upgrade message to the chat.
 */
function addUpgradePrompt(limitType = null, options = {}) {
  if (!elements.chatMessages) return;
  removeReviewPrompts();

  const creditsRemaining =
    coerceNumber(state.user?.creditsRemaining) ??
    coerceNumber(state.user?.credits_remaining);
  const dailyCreditsRemaining =
    coerceNumber(state.user?.dailyCreditsRemaining) ??
    coerceNumber(state.user?.daily_credits_remaining);
  const resolvedLimitType =
    limitType ||
    (dailyCreditsRemaining !== null &&
    dailyCreditsRemaining <= 0 &&
    (creditsRemaining === null || creditsRemaining > 0)
      ? "daily"
      : "monthly");
  const gateType =
    options.gateType ||
    (resolvedLimitType === "daily" ? "daily-hard" : "monthly-hard");

  if (
    state.messages.some(
      (message) => message.isUpgrade && message.gateType === gateType,
    )
  ) {
    return;
  }

  const gateConfig = getGateUIConfig(gateType);

  const message = {
    id: `${gateType}-${Date.now()}`,
    role: "assistant",
    content: options.content || gateConfig.description,
    isUpgrade: true,
    isSafetyPause: gateType === "safety-hard",
    gateType,
    ctaLabel: options.ctaLabel || gateConfig.buttonText,
    upgradeUrl: options.upgradeUrl || gateConfig.upgradeUrl,
    checkoutSource: options.checkoutSource || gateConfig.checkoutSource,
    timestamp: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  state.messages.push(message);
  const renderedMessage = renderMessage(message);
  if (isDollarTrialTreatmentOffer()) {
    trackDollarTrialOfferShownFromPanel(message.checkoutSource);
  }
  renderIdleSuggestion();
  if (renderedMessage) {
    scrollPanelChildIntoView(renderedMessage);
  }
}

async function getChartInfo() {
  const activeTabs = await queryTabsAsync({
    active: true,
    currentWindow: true,
  });
  const tradingViewTabs = await queryTabsAsync({
    url: ["*://*.tradingview.com/chart/*"],
  });
  const candidates = [...activeTabs, ...tradingViewTabs]
    .filter(
      (tab, index, tabs) =>
        tab?.id &&
        tabs.findIndex((candidate) => candidate?.id === tab.id) === index,
    )
    .filter((tab) => isTradingViewChartUrl(tab.url));

  // Fire all candidate tab requests in parallel instead of one at a time -
  // there's usually only 1-2 candidates, but with multiple TradingView tabs
  // open this used to serialize per-tab round trips/timeouts. Selection
  // still walks the results in the original priority order (active tab
  // first, matching this session's convention over query order otherwise).
  const responses = await Promise.all(
    candidates.map((tab) =>
      tab.id ? sendChartInfoRequestToTab(tab.id) : Promise.resolve(null),
    ),
  );

  for (let i = 0; i < candidates.length; i += 1) {
    const responseData = responses[i];
    if (responseData && !isPlaceholderSymbol(responseData.symbol)) {
      return responseData;
    }

    const urlChartInfo = getChartInfoFromUrl(candidates[i].url);
    if (urlChartInfo && !isPlaceholderSymbol(urlChartInfo.symbol)) {
      return urlChartInfo;
    }
  }

  return { symbol: "UNKNOWN", timeframe: "1H" };
}

async function compressScreenshotDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return dataUrl;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Canvas context unavailable"));
        return;
      }

      let { width, height } = img;
      const maxDim = window?.CHARTMENTOR_CONFIG?.SCREENSHOT_MAX_WIDTH || 1024;
      const quality = window?.CHARTMENTOR_CONFIG?.SCREENSHOT_QUALITY || 0.8;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height / width) * maxDim);
          width = maxDim;
        } else {
          width = Math.round((width / height) * maxDim);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Send chat message
 */
async function sendMessage() {
  const content = elements.chatInput.value.trim();
  if (
    !content ||
    state.isAnalyzing ||
    state.isMentorSessionLoading ||
    state.isSubmittingMessage ||
    state.isConversationLoading
  ) return;
  state.isSubmittingMessage = true;
  elements.sendBtn.disabled = true;

  try {

  if (state.awaitingSymbolForAnalysis) {
    addMessage("user", content, { isSymbolClarification: true });
    elements.chatInput.value = "";
    elements.chatInput.disabled = false;
    elements.sendBtn.disabled = false;

    const userProvidedSymbol = normalizeUserSymbolInput(content);
    if (!userProvidedSymbol) {
      addMessage("assistant", SYMBOL_RETRY_MESSAGE, {
        rawText: true,
        responseReady: true,
        isSymbolClarification: true,
      });
      return;
    }

    const pendingOptions = state.awaitingSymbolForAnalysis.options || {
      interactionType: "analysis",
    };
    state.awaitingSymbolForAnalysis = null;
    await startAnalysis(null, {
      ...pendingOptions,
      userProvidedSymbol,
    });
    return;
  }

  // Follow-up chat is available to signed-in users.
  if (!(await ensureAuthenticated())) return;

  await syncCurrentChartContext();
  if (!state.currentHistoryId || !state.currentAnalysis) {
    elements.chatInput.value = "";
    await window.ChartMentorSession?.reply?.(content);
    return;
  }

  // Add user message
  addMessage("user", content);
  elements.chatInput.value = "";
  await persistVisibleChatToCurrentHistory();

  // Enable input for follow-up
  elements.chatInput.disabled = false;
  elements.sendBtn.disabled = false;

  // Every chat turn is grounded in a fresh view of the current chart.
  await startAnalysis(null, {
    interactionType: "follow_up",
    includeScreenshot: true,
  });
  } finally {
    state.isSubmittingMessage = false;
    elements.sendBtn.disabled =
      state.isAnalyzing ||
      state.isConversationLoading ||
      state.isMentorSessionLoading;
  }
}

/**
 * Add message to chat
 */
function addMessage(role, content, options = {}) {
  const message = {
    id: options.id || createConversationUuid(),
    role,
    content,
    ...options,
    timestamp: options.timestamp || new Date().toISOString(),
    remoteSynced: options.remoteSynced === true,
  };
  ensureConversationMessageId(message);

  state.messages.push(message);
  const renderedMessage = renderMessage(message);
  renderIdleSuggestion();

  // Smart Scroll: If it's the assistant's response, scroll to its start so it can be read top-to-bottom
  if (role === "assistant") {
    if (message.responseReady) {
      revealAssistantResult(renderedMessage);
    } else if (renderedMessage) {
      scrollPanelChildIntoView(renderedMessage);
    }
  } else {
    // For user messages, always scroll to bottom
    scrollReviewToEnd();
  }
  return renderedMessage;
}

/**
 * Render a single message
 */
