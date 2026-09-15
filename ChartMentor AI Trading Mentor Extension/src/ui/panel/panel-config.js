/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * This code is licensed under a commercial license.
 * See the LICENSE.md file for details.
 *
 * ChartMentor v2.0 - Panel Main Controller
 * Handles tab switching, chat, analysis, and state management
 */
// Panel State
const state = {
  currentTab: "review",
  messages: [],
  history: [],
  mentorWatchlist: [],
  isAnalyzing: false,
  currentAnalysis: null,
  lastScanSnapshot: null,
  currentHistoryId: null,
  currentConversationId: null,
  conversationLoadGeneration: 0,
  isConversationLoading: false,
  isSubmittingMessage: false,
  isMentorSessionLoading: false,
  user: null,
  tradingProfile: null,
  settings: null,
  currentSymbol: null,
  currentTimeframe: null,
  symbolConfidence: null,
  chartContextMonitorId: null,
  chartContextRevision: 0,
  unreliableChartContextStreak: 0,
  pendingChartContextKey: null,
  panelMessageToken: null,
  panelSurfaceVisible: false,
  panelTabScope: null,
  activeScanRequestId: null,
  activeScanOwnerSubject: null,
  activeScanStorageKeys: null,
  activeScanIsProactive: false,
  isClearingSession: false,
  scanGeneration: 0,
  isViewingPreviousScan: false,
  currentReviewMode: "signal_generator",
  currentSetupType: "other",
  awaitingSymbolForAnalysis: null,
  isAuthenticated: false,
  firstRunPending: false,
  loadingIntervalId: null,
  loadingPhaseIndex: 0,
  idleSuggestionIndex: 0,
  idleSuggestionIntervalId: null,
  idleSuggestionAnimating: false,
  extensionReadiness: {
    ready: false,
    reason: "extension_loading",
    label: "Preparing...",
  },
  paywallDismissed: false,
  dollarTrialOfferSurfacesShown: new Set(),
};

const AUTH_SIGNUP_URL =
  "https://chartmentor.io/auth?plan=free&mode=signup&source=extension";
const ACCOUNT_URL = "https://chartmentor.io/account";
const LIMIT_GATE_PRICING_URL =
  "https://chartmentor.io/?source=extension_limit_gate&plan=pro#pricing";
const EXTENSION_PRICING_PLANS = {
  free: "pro",
  starter: "pro",
  pro: null,
  elite: "elite",
};
const TIER_DISPLAY_LABELS = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  elite: "Elite",
};
const USAGE_GATE_TYPES = new Set([
  "monthly-soft",
  "monthly-hard",
  "daily-hard",
  "safety-hard",
]);
const EXTENSION_ONBOARDING_COMPLETE_KEY =
  "chartmentor_extension_onboarding_complete";
const MAX_PERSISTED_CHAT_MESSAGES = 200;
const VALUE_NUDGE_MILESTONES = new Set([2, 5]);
const SYMBOL_REQUIRED_MESSAGE =
  "I couldn't read a reliable symbol from that screenshot. Clean up the chart so the top-left title is visible, or type the symbol manually if you want to continue.";
const SYMBOL_RETRY_MESSAGE =
  "I still couldn't read a reliable symbol from that. Clean the chart, keep one symbol visible, or send only the symbol, for example BTCUSDT, XAUUSD, NAS100, or BINANCE:BNBUSDT.";
const SYMBOL_PLACEHOLDERS = new Set([
  "",
  "UNKNOWN",
  "SYMBOL",
  "TICKER",
  "N/A",
  "NA",
  "NONE",
  "NULL",
]);
const SYMBOL_REPLY_STOPWORDS = new Set([
  "I",
  "IM",
  "AM",
  "TRADING",
  "TRADE",
  "SYMBOL",
  "TICKER",
  "CHART",
  "THE",
  "THIS",
  "IS",
  "IT",
  "PAIR",
  "MARKET",
  "ON",
  "FOR",
  "PLEASE",
  "UNKNOWN",
]);
const HIDDEN_CONTEXT_MESSAGE_PREFIXES = [
  "analysis-context-",
  "market-context-",
  "setup-context-",
];
const DEFAULT_SETTINGS = {
  model: "gpt-4o-mini",
  language: "english",
  reviewMode: "signal_generator",
  setupType: "other",
  hasCustomLens: false,
  responseLength: "standard",
  mentorVoice: "sharp_mentor",
  mentorVoiceProfileSelected: false,
  mentorVoicePromptShownAt: null,
  lensNudgeShownAt: null,
};

const SETUP_LENS_OPTIONS = [
  {
    value: "other",
    label: "Auto lens",
    shortLabel: "Auto",
    description:
      "ChartMentor reads the chart's structure itself and finds the clearest setup - no trading jargon required.",
  },
  {
    value: "custom",
    label: "Custom lens",
    shortLabel: "Custom",
    description: "A custom lens saved previously; no longer editable in-app.",
  },
  {
    value: "icc",
    label: "ICC beginner",
    shortLabel: "ICC",
    description:
      "Indication, Correction, Continuation. Best for learning structure first.",
  },
  {
    value: "ict",
    label: "ICT / SMC",
    shortLabel: "ICT",
    description:
      "Liquidity, displacement, order blocks, FVGs, premium/discount.",
  },
  {
    value: "momentum",
    label: "Momentum",
    shortLabel: "Momentum",
    description: "Breakouts, continuation, expansion, and pullback quality.",
  },
  {
    value: "mean_reversion",
    label: "Mean reversion",
    shortLabel: "Mean Rev",
    description: "Overextension, rejection, range edges, and value snapback.",
  },
  {
    value: "scalp",
    label: "Scalp",
    shortLabel: "Scalp",
    description: "Micro-structure, intraday liquidity, and tight invalidation.",
  },
];
const CHART_FINGERPRINT_VERSION = 1;
const VALID_SETUP_TYPES = new Set(
  SETUP_LENS_OPTIONS.map((option) => option.value),
);
const MENTOR_VOICE_OPTIONS = [
  {
    value: "sharp_mentor",
    label: "Sharp mentor",
    description: "Direct, protective, human, and focused on execution.",
    sample: "Set the alert first.",
  },
  {
    value: "strict_coach",
    label: "Strict coach",
    description: "Blunt accountability, no comfort, calls out weak discipline.",
    sample: "Invalid. Fix the plan.",
  },
  {
    value: "calm_pro",
    label: "Calm pro",
    description: "Desk-style, measured, concise, and no slang.",
    sample: "Set alert. Reassess.",
  },
];
const VALID_MENTOR_VOICES = new Set(
  MENTOR_VOICE_OPTIONS.map((option) => option.value),
);

function normalizeSetupType(value) {
  return VALID_SETUP_TYPES.has(value) ? value : DEFAULT_SETTINGS.setupType;
}

function getSetupLensConfig(value = state.currentSetupType) {
  return (
    SETUP_LENS_OPTIONS.find(
      (option) => option.value === normalizeSetupType(value),
    ) || SETUP_LENS_OPTIONS[0]
  );
}

function shouldUseIccStarterLens(tradingProfile) {
  if (!tradingProfile || typeof tradingProfile !== "object") return false;
  if (tradingProfile.setup_type === "icc") return true;
  return Boolean(
    tradingProfile.trading_experience === "beginner" &&
    tradingProfile.primary_goal === "learn_to_trade",
  );
}

function normalizeMentorVoice(value) {
  if (value === "protective_bro") return "sharp_mentor";
  return VALID_MENTOR_VOICES.has(value) ? value : DEFAULT_SETTINGS.mentorVoice;
}

function isMentorVoiceValue(value) {
  return VALID_MENTOR_VOICES.has(value) || value === "protective_bro";
}

function escapePanelHtml(value) {
  const div = document.createElement("div");
  div.textContent = normalizePanelText(value);
  return div.innerHTML;
}

function escapePanelAttribute(value) {
  return escapePanelHtml(value).replace(/"/g, "&quot;");
}

function buildSignupUrl(extraParams = {}) {
  const url = new URL(AUTH_SIGNUP_URL);
  Object.entries(extraParams).forEach(([key, value]) => {
    if (
      value !== null &&
      typeof value !== "undefined" &&
      String(value).trim()
    ) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function trackPanelEvent(eventName, eventData = {}) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "trackAnalyticsEvent",
      eventName,
      eventData,
    });
    return Boolean(response?.success);
  } catch (error) {
    console.debug(
      "ChartMentor: panel analytics event skipped",
      eventName,
      error,
    );
    return false;
  }
}

const MIN_STRUCTURED_SIGNAL_CONFIDENCE = 65;

const LOADING_SEQUENCES = {
  signal_generator: [
    "Capturing chart",
    "Reading your declared plan",
    "Reading market structure",
    "Checking your Strategy Lens",
    "Looking for rule conflicts",
    "Checking your invalidation",
    "Preparing the review",
  ],
};

// DOM Elements
const elements = {};

function getParentMessageTargetOrigin() {
  const ancestorOrigins = window.location && window.location.ancestorOrigins;
  if (ancestorOrigins && ancestorOrigins.length > 0) {
    return ancestorOrigins[0];
  }

  try {
    if (document.referrer) {
      return new URL(document.referrer).origin;
    }
  } catch (e) {
    console.warn("ChartMentor: Unable to resolve parent origin", e);
  }

  return "https://www.tradingview.com";
}

async function hasAuthToken() {
  try {
    return Boolean(await ChartMentorStorage.getAuthToken());
  } catch (_error) {
    return false;
  }
}

function getUserTier(userProfile) {
  if (!userProfile) return "free";

  const tier = String(
    userProfile.planTier ||
      userProfile.subscriptionStatus ||
      userProfile.plan_tier ||
      userProfile.subscription_status ||
      "free",
  ).toLowerCase();

  if (tier.includes("elite")) return "elite";
  if (tier.includes("pro")) return "pro";
  if (tier.includes("starter")) return "starter";
  return "free";
}

function normalizeTier(rawTier) {
  const tier = String(rawTier || "free").toLowerCase();
  if (tier.includes("elite")) return "elite";
  if (tier.includes("pro")) return "pro";
  if (tier.includes("starter")) return "starter";
  return "free";
}
