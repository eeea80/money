function applyOptimisticUsageCharge() {
  if (!state.isAuthenticated || !state.user) return false;

  const monthlyLimit = getMonthlyScanLimit(state.user);
  const creditsRemaining =
    coerceNumber(state.user.creditsRemaining) ??
    coerceNumber(state.user.credits_remaining);
  const dailyCreditsRemaining =
    coerceNumber(state.user.dailyCreditsRemaining) ??
    coerceNumber(state.user.daily_credits_remaining);

  if (creditsRemaining === null && dailyCreditsRemaining === null) return false;

  const nextCreditsRemaining =
    creditsRemaining !== null ? Math.max(creditsRemaining - 1, 0) : null;
  const nextDailyCreditsRemaining =
    dailyCreditsRemaining !== null
      ? Math.max(dailyCreditsRemaining - 1, 0)
      : null;
  const currentScansUsed =
    coerceNumber(state.user.scansUsed) ??
    coerceNumber(state.user.scans_used) ??
    0;
  const nextScansUsed =
    nextCreditsRemaining !== null
      ? Math.max(0, Math.min(monthlyLimit, monthlyLimit - nextCreditsRemaining))
      : currentScansUsed + 1;

  state.user = {
    ...state.user,
    monthlyLimit,
    scansUsed: nextScansUsed,
    creditsRemaining: nextCreditsRemaining ?? creditsRemaining,
    dailyCreditsRemaining: nextDailyCreditsRemaining ?? dailyCreditsRemaining,
    optimisticUsageSync: true,
  };

  updateUsageDisplay();
  chrome.storage.local.set({ user: state.user }).catch((error) => {
    console.error(
      "ChartMentor: Failed to persist optimistic usage update",
      error,
    );
  });

  return true;
}

function getReadinessCopy() {
  if (state.isAnalyzing) {
    return "Scanning";
  }
  if (isExtensionReadyForAnalysis()) return "Ready";
  return state.extensionReadiness?.label || "Preparing...";
}

function getEmptyReviewStateHtml() {
  const label = state.isAuthenticated
    ? "Connecting to your mentor"
    : "Log in to start your mentor session";
  return `
    <div id="manual-plan-opener" class="empty-state activation-state mentor-session-placeholder" role="status">
      <span class="chartmentor-thinking-indicator" aria-hidden="true"><span></span><span></span><span></span></span>
      <span>${escapePanelHtml(label)}</span>
    </div>
  `;
}

function isOnboardingVisible() {
  return Boolean(elements.chatMessages?.querySelector(".onboarding-state"));
}

function setReviewContentMode(enabled) {
  const panel = document.getElementById("chartmentor-panel");
  if (panel) {
    panel.classList.toggle("has-review-content", Boolean(enabled));
  }
}

function hasVisibleAnalysisCard() {
  return Boolean(
    elements.chatMessages?.querySelector(
      ".review-card, .setup-scan-card, .chart-quality-blocked-card",
    ),
  );
}

function syncVisibleEmptyReviewState() {
  if (
    !elements.chatMessages ||
    state.isAnalyzing ||
    hasVisibleAnalysisCard() ||
    isOnboardingVisible()
  )
    return;

  const emptyState = elements.chatMessages.querySelector(
    ":scope > .empty-state.activation-state",
  );
  if (!emptyState) return;

  if (emptyState && state.isAuthenticated) {
    window.ChartMentorSession?.openIfNeeded?.();
  }
}

function clearReviewPlaceholder() {
  if (!elements.chatMessages) return;

  Array.from(elements.chatMessages.children).forEach((child) => {
    if (child.classList.contains("empty-state")) {
      child.remove();
    }
  });
}

function clearAuthRequiredMessages() {
  if (!Array.isArray(state.messages)) return;

  const beforeCount = state.messages.length;
  state.messages = state.messages.filter((message) => !message?.isAuthRequired);
  if (beforeCount === state.messages.length) return;

  if (elements.chatMessages) {
    elements.chatMessages
      .querySelectorAll('[data-auth-required-message="true"]')
      .forEach((messageEl) => messageEl.remove());

    if (state.messages.length === 0 && !isOnboardingVisible()) {
      setReviewContentMode(false);
      elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
      renderIdleSuggestion();
    }
  }
}

function normalizePanelText(value) {
  return typeof value === "string" ? value.trim() : "";
}

const PLANNED_REVIEW_ACTION =
  "Treat this as a planned setup scan, not an open position. Only enter if the trigger is still valid and the stop and target are defined before execution.";

const OPEN_POSITION_DISPLAY_PATTERN =
  /\b(?:hold(?:ing)?\s+(?!(?:off|until|for)\b)(?:(?:the|this|your|my|our)\s+)?(?:(?:open|active|live|current)\s+)?(?:(?:long|short)\s+)?(?:position|trade|long|short)|trail(?:ing)?\s+(?:the\s+)?stop|take partials?|partials?|partial profits?|scale out|scale off|protect(?:ing)? profits?|lock in profits?|de-?risk|reduce exposure|move\s+(?:the\s+)?stop|break[- ]?even|(?:currently|stays|remains|is)\s+in profit|open position|open trade|active position|(?:open|active|live|current)\s+(?:long|short)(?:\s+position)?|(?:your|my|our|this|the)\s+(?:long|short)\s+position(?!\s+(?:tool|box))|stay in(?: the)?\s+(?:position|trade|long|short)|keep\s+(?:the\s+)?(?:(?:open|active|live|current)\s+)?(?:position|trade|long|short)|maintain\s+(?:the\s+)?(?:position|trade|long|short)|exit\s+(?:(?:half|part|partial|some)\s+)?(?:of\s+)?(?:the\s+)?(?:position|trade|long|short)|close\s+(?:(?:half|part|partial|some)\s+)?(?:of\s+)?(?:the\s+)?(?:position|trade|long|short)|let\s+(?:the\s+)?(?:position|trade|long|short)\s+run)\b/i;

function sanitizeOpenPositionDisplayText(value) {
  if (typeof value !== "string" || !value.trim()) return value;

  const protectedPhrases = [];
  const protect = (phrase) => {
    protectedPhrases.push(phrase);
    return `__CM_PROTECTED_${protectedPhrases.length - 1}__`;
  };

  const sanitized = value
    .replace(/\bnot\s+an?\s+open\s+position\b/gi, protect)
    .replace(/\bnot\s+an?\s+open\s+trade\b/gi, protect)
    .replace(/\bnot\s+an?\s+active\s+position\b/gi, protect)
    .replace(/\bnot\s+an?\s+active\s+trade\b/gi, protect)
    .replace(
      /\bnot\s+(?:an?\s+)?(?:open|active|live|current)\s+(?:long|short)(?:\s+position)?\b/gi,
      protect,
    )
    .replace(
      /\bnot\s+(?:an?\s+)?(?:open|active|live|current)?\s*(?:long|short)\s+position\b/gi,
      protect,
    )
    .replace(/\b(?:long|short)\s+position\s+(?:tool|box)\b/gi, protect)
    .replace(
      /\bhold(?:ing)?\s+(?!(?:off|until|for)\b)(?:(?:the|this|your|my|our)\s+)?(?:(?:open|active|live|current)\s+)?(?:(?:long|short)\s+)?(?:position|trade|long|short)\b/gi,
      "treat the visible levels as a planned setup",
    )
    .replace(
      /\b(?:open|active|live|current)\s+(long|short)(?:\s+position)?\b/gi,
      "planned $1 setup",
    )
    .replace(
      /\b(?:your|my|our|this|the)\s+(long|short)\s+position(?!\s+(?:tool|box))\b/gi,
      "the planned $1 setup",
    )
    .replace(/\bopen position\b/gi, "planned trade idea")
    .replace(/\bopen trade\b/gi, "planned trade idea")
    .replace(/\bactive position\b/gi, "planned trade idea")
    .replace(
      /\btrail(?:ing)? (?:the )?stop\b/gi,
      "keep the invalidation level defined before entry",
    )
    .replace(
      /\bmove\s+(?:the\s+)?stop\b/gi,
      "keep the invalidation level defined before entry",
    )
    .replace(/\bbreak[- ]?even\b/gi, "the planned invalidation area")
    .replace(/\btake partials?\b/gi, "define partial targets before entry")
    .replace(/\bpartials?\b/gi, "planned targets")
    .replace(/\bpartial profits?\b/gi, "planned targets")
    .replace(/\bscale (?:out|off)\b/gi, "define scale-out targets before entry")
    .replace(
      /\bprotect(?:ing)? profits?\b/gi,
      "define profit-protection rules before entry",
    )
    .replace(
      /\block in profits?\b/gi,
      "define profit-protection rules before entry",
    )
    .replace(/\bde-?risk\b/gi, "reduce risk before entry")
    .replace(/\breduce exposure\b/gi, "reduce planned risk before entry")
    .replace(
      /\b(?:currently|stays|remains|is)\s+in profit\b/gi,
      "confirms the planned target path",
    )
    .replace(
      /\bstay in(?: the)?\s+(?:position|trade|long|short)\b/gi,
      "treat the visible levels as a planned setup",
    )
    .replace(
      /\bkeep\s+(?:the\s+)?(?:(?:open|active|live|current)\s+)?(?:position|trade|long|short)\b/gi,
      "treat the visible levels as a planned setup",
    )
    .replace(
      /\bmaintain\s+(?:the\s+)?(?:position|trade|long|short)\b/gi,
      "treat the visible levels as a planned setup",
    )
    .replace(
      /\bexit\s+(?:(?:half|part|partial|some)\s+)?(?:of\s+)?(?:the\s+)?(?:position|trade|long|short)\b/gi,
      "define exit conditions before entry",
    )
    .replace(
      /\bclose\s+(?:(?:half|part|partial|some)\s+)?(?:of\s+)?(?:the\s+)?(?:position|trade|long|short)\b/gi,
      "define exit conditions before entry",
    )
    .replace(
      /\blet\s+(?:the\s+)?(?:position|trade|long|short)\s+run\b/gi,
      "set an alert for the planned setup to confirm",
    );

  return protectedPhrases.reduce(
    (result, phrase, index) =>
      result.replace(`__CM_PROTECTED_${index}__`, phrase),
    sanitized,
  );
}

function isTradeEvaluatorHistoryItem(item) {
  return Boolean(
    item?.verdict &&
    (item.reviewMode === "trade_evaluator" ||
      item.reviewMode === "trade_evaluator_fallback"),
  );
}

function sanitizeHistoryItemForDisplay(item) {
  if (!item) return item;

  const boundedItem = {
    ...item,
    mentorReview:
      typeof normalizeMentorReview === "function"
        ? normalizeMentorReview(item.mentorReview || item.mentor_review)
        : null,
    declaredPlan:
      typeof normalizeStoredDeclaredPlan === "function"
        ? normalizeStoredDeclaredPlan(item.declaredPlan || item.declared_plan)
        : null,
  };
  if (!isTradeEvaluatorHistoryItem(boundedItem)) return boundedItem;

  const sanitized = { ...boundedItem };
  if (OPEN_POSITION_DISPLAY_PATTERN.test(sanitized.action || "")) {
    sanitized.action = PLANNED_REVIEW_ACTION;
  }

  ["mistake", "explanation", "psychology", "analysis"].forEach((field) => {
    if (OPEN_POSITION_DISPLAY_PATTERN.test(sanitized[field] || "")) {
      sanitized[field] = sanitizeOpenPositionDisplayText(sanitized[field]);
    }
  });

  if (Array.isArray(sanitized.deepDivePrompts)) {
    sanitized.deepDivePrompts = sanitized.deepDivePrompts.map((prompt) =>
      OPEN_POSITION_DISPLAY_PATTERN.test(prompt || "")
        ? sanitizeOpenPositionDisplayText(prompt)
        : prompt,
    );
  }

  sanitized.preview =
    (sanitized.mistake || sanitized.analysis || sanitized.preview || "")
      .substring(0, 150)
      .replace(/[#*`]/g, "") || "Chart scan...";
  return sanitized;
}

function normalizeSignalValue(value, fallback = "-") {
  if (value === null || typeof value === "undefined") return fallback;
  const text = String(value).trim();
  return text || fallback;
}
