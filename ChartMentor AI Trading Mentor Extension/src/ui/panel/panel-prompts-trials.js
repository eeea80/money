function getPromptAnalyticsContext(analysisData = null) {
  if (!analysisData || typeof analysisData !== "object") {
    return {
      verdict: null,
      reviewMode: null,
      responseType: null,
      tradeIdeaStatus: null,
      signalCount: 0,
      hasWatchCondition: false,
      lastValueMoment: "unknown",
    };
  }

  const verdict =
    normalizePanelText(analysisData.verdict).toUpperCase() || null;
  const reviewMode =
    normalizePanelText(analysisData.reviewMode || analysisData.review_mode) ||
    null;
  const responseType =
    normalizePanelText(
      analysisData.responseType || analysisData.response_type,
    ) || null;
  const tradeIdeaStatus =
    normalizePanelText(
      analysisData.tradeIdeaStatus || analysisData.trade_idea_status,
    ) || null;
  const signals = Array.isArray(analysisData.signals)
    ? analysisData.signals
    : [];
  const watchCondition =
    analysisData.watchCondition || analysisData.watch_condition || null;
  const hasWatchCondition = Boolean(
    watchCondition &&
    typeof watchCondition === "object" &&
    (normalizePanelText(watchCondition.trigger) ||
      normalizePanelText(watchCondition.level) ||
      normalizePanelText(watchCondition.entry) ||
      normalizePanelText(watchCondition.alertLevel)),
  );
  const visualPreflight =
    analysisData.visualPreflight || analysisData.visual_preflight || {};
  const isBlockedScreenshot = Boolean(
    visualPreflight &&
    typeof visualPreflight === "object" &&
    (visualPreflight.isAnalyzable === false ||
      visualPreflight.is_analyzable === false),
  );

  let lastValueMoment = "unknown";
  if (isBlockedScreenshot) {
    lastValueMoment = "chart_quality_blocked";
  } else if (tradeIdeaStatus === "not_found") {
    lastValueMoment = "no_marked_trade";
  } else if (
    reviewMode === "signal_generator" ||
    responseType === "setup_text"
  ) {
    lastValueMoment =
      signals.length > 0 || hasWatchCondition
        ? "setup_scan_actionable"
        : "setup_scan_no_signal";
  }

  return {
    verdict,
    reviewMode,
    responseType,
    tradeIdeaStatus,
    signalCount: signals.length,
    hasWatchCondition,
    lastValueMoment,
  };
}

function normalizeValueNudgeMilestonesShown(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [key, shown]) => {
    if (shown === true && VALUE_NUDGE_MILESTONES.has(Number(key))) {
      acc[String(Number(key))] = true;
    }
    return acc;
  }, {});
}

function isValueNudgeEligibleResult(analysisData) {
  if (!analysisData || typeof analysisData !== "object") return false;

  const visualPreflight =
    analysisData.visualPreflight || analysisData.visual_preflight || {};
  if (visualPreflight && typeof visualPreflight === "object") {
    if (
      visualPreflight.isAnalyzable === false ||
      visualPreflight.is_analyzable === false
    )
      return false;
    const blockReason = normalizePanelText(
      visualPreflight.blockReason || visualPreflight.block_reason,
    );
    if (blockReason) return false;
  }

  const context = getPromptAnalyticsContext(analysisData);
  return context.lastValueMoment === "setup_scan_actionable";
}

async function checkValueNudgePrompt(scansUsed, analysisData = null) {
  if (getUserTier(state.user) !== "free") return;
  if (hasVisibleConversionPrompt() || getCurrentUsageGate()) return;
  if (!isValueNudgeEligibleResult(analysisData)) return;

  const creditsRemaining =
    coerceNumber(state.user?.creditsRemaining) ??
    coerceNumber(state.user?.credits_remaining);
  if (creditsRemaining !== null && creditsRemaining <= 1) return;

  const result = await chrome.storage.local.get([
    "valueNudgeMilestonesShown",
    "lastValueNudgePromptAt",
    "valueNudgeEligibleResultCount",
  ]);

  const previousEligibleCount = Math.max(
    0,
    Number(result.valueNudgeEligibleResultCount) || 0,
  );
  const eligibleResultCount = previousEligibleCount + 1;
  await chrome.storage.local.set({
    valueNudgeEligibleResultCount: eligibleResultCount,
  });

  const milestone = VALUE_NUDGE_MILESTONES.has(eligibleResultCount)
    ? eligibleResultCount
    : null;
  if (!milestone) return;

  const milestonesShown = normalizeValueNudgeMilestonesShown(
    result.valueNudgeMilestonesShown,
  );
  if (
    milestonesShown[String(milestone)] ||
    Number(result.lastValueNudgePromptAt) === milestone
  )
    return;

  const nudgeContext = getPromptAnalyticsContext(analysisData);
  addUpgradePrompt("value", {
    gateType: "value-nudge",
    content: isDollarTrialTreatmentOffer()
      ? "That review caught a decision point before you committed risk. Start seven days of Pro for $1 today. Then $39.99/month unless canceled."
      : "That review caught a decision point before you committed risk. Keep the memory and outcome loop so the next review can use what you learned here.",
    ctaLabel: isDollarTrialTreatmentOffer()
      ? "Start 7-Day Pro for $1"
      : "Keep the record",
    upgradeUrl: getExtensionPricingUrl(
      "extension_value_nudge",
      state.user?.tier,
    ),
    checkoutSource: "extension_value_nudge",
  });
  trackPanelEvent("value_nudge_shown", {
    source: "extension",
    milestone,
    scansUsed,
    eligibleResultCount,
    ...nudgeContext,
  });

  milestonesShown[String(milestone)] = true;
  chrome.storage.local.set({
    lastValueNudgePromptAt: milestone,
    valueNudgeMilestonesShown: milestonesShown,
  });
}

function removeReviewPrompts() {
  const previousMessageCount = state.messages.length;
  state.messages = state.messages.filter((message) => !message?.isReview);
  elements.chatMessages
    ?.querySelectorAll('[data-review-request="true"]')
    .forEach((messageEl) => {
      messageEl.remove();
    });
  return previousMessageCount !== state.messages.length;
}

function removeUsageGatePrompts(gateTypes = USAGE_GATE_TYPES) {
  const types = gateTypes instanceof Set ? gateTypes : new Set(gateTypes);
  const previousMessageCount = state.messages.length;
  let removedDomPrompt = false;

  state.messages = state.messages.filter(
    (message) => !(message.isUpgrade && types.has(message.gateType)),
  );
  elements.chatMessages
    ?.querySelectorAll("[data-upgrade-gate]")
    .forEach((messageEl) => {
      if (types.has(messageEl.dataset.upgradeGate)) {
        messageEl.remove();
        removedDomPrompt = true;
      }
    });

  return removedDomPrompt || previousMessageCount !== state.messages.length;
}
