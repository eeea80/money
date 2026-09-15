function getMonthlyScanLimit(userProfile) {
  if (userProfile && typeof userProfile === "object") {
    const explicitLimit =
      coerceNumber(userProfile.monthlyLimit) ??
      coerceNumber(userProfile.monthly_limit);
    if (explicitLimit !== null) return explicitLimit;
  }

  const tier =
    typeof userProfile === "string"
      ? normalizeTier(userProfile)
      : getUserTier(userProfile);
  const limitFromConfig =
    window?.CHARTMENTOR_CONFIG?.RATE_LIMITS?.[tier]?.monthly;
  if (Number.isFinite(limitFromConfig)) return limitFromConfig;

  return (
    {
      free: 1,
      starter: 2000,
      pro: 2000,
      elite: 2000,
    }[tier] || 1
  );
}

function isDollarTrialTreatmentOffer(user = state.user) {
  return Boolean(
    user?.monetizationOffer?.enabled === true &&
      user?.monetizationOffer?.variant === "dollar_trial" &&
      user?.monetizationOffer?.showOffer === true,
  );
}

function getExtensionPricingUrl(source, tier = state.user?.tier) {
  const plan = EXTENSION_PRICING_PLANS[normalizeTier(tier)] || "pro";
  const offer = isDollarTrialTreatmentOffer()
    ? "&offer=dollar_trial_1"
    : "";
  return `https://chartmentor.io/?source=${encodeURIComponent(source)}&plan=${encodeURIComponent(plan)}${offer}#pricing`;
}

function getTierDisplayLabel(tier) {
  return TIER_DISPLAY_LABELS[normalizeTier(tier)] || "Free";
}

function getNextUpgradeTier(tier) {
  const normalizedTier = normalizeTier(tier);
  const nextTier = EXTENSION_PRICING_PLANS[normalizedTier];
  return nextTier && nextTier !== normalizedTier ? nextTier : null;
}

function hasFreshUserSync(user = state.user) {
  const lastSyncMs = user?.lastSync ? Date.parse(user.lastSync) : null;
  return (
    Number.isFinite(lastSyncMs) && Date.now() - lastSyncMs < 6 * 60 * 60 * 1000
  );
}

function getCurrentUsageGate() {
  if (!state.isAuthenticated || !state.user || !hasFreshUserSync(state.user))
    return null;

  const creditsRemaining =
    coerceNumber(state.user.creditsRemaining) ??
    coerceNumber(state.user.credits_remaining);
  const dailyCreditsRemaining =
    coerceNumber(state.user.dailyCreditsRemaining) ??
    coerceNumber(state.user.daily_credits_remaining);
  const tier = getUserTier(state.user);
  const isPaidTier = tier !== "free";

  if (
    isPaidTier &&
    ((creditsRemaining !== null && creditsRemaining <= 0) ||
      (dailyCreditsRemaining !== null && dailyCreditsRemaining <= 0))
  ) {
    return { gateType: "safety-hard", limitType: "safety" };
  }
  if (isPaidTier) return null;

  if (creditsRemaining !== null && creditsRemaining <= 0) {
    return { gateType: "monthly-hard", limitType: "monthly" };
  }

  if (dailyCreditsRemaining !== null && dailyCreditsRemaining <= 0) {
    return { gateType: "daily-hard", limitType: "daily" };
  }

  if (creditsRemaining !== null && creditsRemaining <= 3) {
    return { gateType: "monthly-soft", limitType: "monthly" };
  }

  return null;
}

function coerceNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeStoredReviewMode(mode) {
  return "signal_generator";
}

function toBackendReviewMode(mode) {
  // The backend still owns compatibility mapping, while the visible primary
  // flow always supplies a user-declared plan.
  return "auto";
}

function isValidReviewMode(mode) {
  return mode === "signal_generator" || mode === "review";
}

function getReviewModeConfig(
  mode = state.currentReviewMode || "signal_generator",
) {
  return {
    mode: "signal_generator",
    label: "Review Plan",
    cta: "Review Chart",
    badge: "Plan review",
    emptyTitle: "State the trade before I judge it.",
    emptyPrimary:
      "Mark a Long or Short Position, or enter direction, entry, stop, and target manually.",
    emptySecondary:
      "I check facts, your rules, and the weakest assumption. You decide.",
    placeholder: "Ask about the current chart...",
  };
}

function getChatInputPlaceholder(mode = state.currentReviewMode) {
  if (state.currentAnalysis) {
    return "Ask what changed or challenge the review...";
  }
  return "Reply to your mentor...";
}

function getBackendMessages(maxMessages = 8, options = {}) {
  const includeHiddenContext = Boolean(options.includeHiddenContext);
  const validMessages = (state.messages || [])
    .filter(
      (m) => m && typeof m.role === "string" && typeof m.content === "string",
    )
    .filter((m) => !m.isReview && !m.isUpgrade && !m.isAuthRequired)
    .filter((m) => !m.isSymbolClarification);

  const latestContext = includeHiddenContext
    ? [...validMessages].reverse().find(isHiddenContextMessage)
    : null;
  const visibleMessages = validMessages.filter(
    (m) => !isHiddenContextMessage(m),
  );
  const visibleLimit = latestContext
    ? Math.max(0, maxMessages - 1)
    : maxMessages;
  const messagesToSend = latestContext
    ? [latestContext, ...visibleMessages.slice(-visibleLimit)]
    : visibleMessages.slice(-maxMessages);

  return messagesToSend.map((m) => ({ role: m.role, content: m.content }));
}

function isPlaceholderSymbol(rawValue) {
  const normalized = String(rawValue || "")
    .trim()
    .toUpperCase();
  return SYMBOL_PLACEHOLDERS.has(normalized);
}

function isUsableChartSymbol(chartInfo) {
  if (!chartInfo || chartInfo.symbolSource === "url") return false;
  const symbol = String(chartInfo.symbol || "").trim();
  if (isPlaceholderSymbol(symbol)) return false;
  if (!/[A-Z0-9]/i.test(symbol)) return false;
  return true;
}

function normalizeUrlTimeframe(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const compact = raw.toLowerCase();
  if (/^\d+$/.test(compact)) {
    const minutes = Number(compact);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    if (minutes < 60) return `${minutes}m`;
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes}m`;
  }
  return raw;
}

function getChartInfoFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || "");
    const symbolParam =
      url.searchParams.get("symbol") || url.searchParams.get("ticker") || "";
    const intervalParam =
      url.searchParams.get("interval") ||
      url.searchParams.get("timeframe") ||
      "";
    const symbolParts = normalizeUserSymbolInput(symbolParam);
    if (!symbolParts?.symbol) return null;

    return {
      symbol: symbolParts.symbol,
      exchange: symbolParts.exchange,
      timeframe: normalizeUrlTimeframe(intervalParam) || "1h",
      symbolSource: "url",
      timeframeSource: intervalParam ? "url" : undefined,
    };
  } catch (error) {
    return null;
  }
}

function isTradingViewChartUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || "");
    return (
      /(^|\.)tradingview\.com$/i.test(url.hostname) &&
      url.pathname.includes("/chart/")
    );
  } catch (error) {
    return false;
  }
}

function queryTabsAsync(queryInfo) {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) {
        resolve([]);
        return;
      }
      resolve(Array.isArray(tabs) ? tabs : []);
    });
  });
}

function sendChartInfoRequestToTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "getSymbolAndTimeframe" },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          resolve(null);
          return;
        }
        resolve(response.data || null);
      },
    );
  });
}

function normalizeUserSymbolInput(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return null;
  const upper = rawValue.trim().toUpperCase();

  const explicitPair = upper.match(
    /\b([A-Z0-9._-]{1,30}):([A-Z0-9._-]{2,40})\b/,
  );
  const explicitSymbol = explicitPair?.[2]?.replace(/[.,;!?]+$/g, "");
  if (explicitPair && !isPlaceholderSymbol(explicitSymbol)) {
    return {
      exchange: explicitPair[1],
      symbol: explicitSymbol,
      symbolSource: "user",
    };
  }

  const candidates = upper.match(/[A-Z0-9][A-Z0-9._-]{1,39}/g) || [];
  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.replace(/[.,;!?]+$/g, "");
    if (SYMBOL_REPLY_STOPWORDS.has(candidate) || isPlaceholderSymbol(candidate))
      continue;
    if (!/[A-Z]/.test(candidate) && !/\d/.test(candidate)) continue;
    return {
      symbol: candidate,
      symbolSource: "user",
    };
  }

  return null;
}

function requestSymbolForAnalysis(options = {}) {
  state.awaitingSymbolForAnalysis = {
    options: {
      interactionType: "analysis",
      ...(options || {}),
    },
  };
  addMessage("assistant", SYMBOL_REQUIRED_MESSAGE, {
    rawText: true,
    responseReady: true,
    isSymbolClarification: true,
  });
  if (elements.chatInput) {
    elements.chatInput.disabled = false;
    elements.chatInput.placeholder = "Type the symbol, e.g. BTCUSDT";
    elements.chatInput.focus();
  }
  if (elements.sendBtn) {
    elements.sendBtn.disabled = false;
  }
}

function isHiddenContextMessage(message) {
  const messageId = String(message?.id || "");
  return Boolean(
    message?.hiddenContext ||
    HIDDEN_CONTEXT_MESSAGE_PREFIXES.some((prefix) =>
      messageId.startsWith(prefix),
    ),
  );
}

function isPersistableChatMessage(message) {
  if (!message || isHiddenContextMessage(message)) return false;
  if (message.role !== "user" && message.role !== "assistant") return false;
  if (typeof message.content !== "string" || !message.content.trim())
    return false;
  if (
    message.isReview ||
    message.isUpgrade ||
    message.isAuthRequired ||
    message.isAnalysisError ||
    message.isHistorySyncNotice
  )
    return false;
  if (message.isSymbolClarification) return false;
  return true;
}
