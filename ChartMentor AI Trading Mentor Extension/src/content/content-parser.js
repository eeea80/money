/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Content Script Chart Parsing Logic
 */

function getTextContent(element) {
  return element?.textContent?.trim() || "";
}

const SYMBOL_STOPWORDS = new Set([
  "BUY",
  "SELL",
  "CHART",
  "CANDLES",
  "INDEX",
  "INDICATOR",
  "INDICATORS",
  "STRATEGY",
  "TRADINGVIEW",
  "WATCHLIST",
  "REPLAY",
  "ALERT",
  "LAYOUT",
  "MENU",
  "SETTINGS",
  "VERBINDUNG",
  "UNNAMED",
  "PUBLISH",
  "SYMBOL",
  "TICKER",
  "TRADE",
  "UTC",
  "UNKNOWN",
]);

function isLikelyTimeframeToken(token) {
  return (
    /^\d+$/.test(token) ||
    /^\d+(?:S|M|H|D|W|MO)$/i.test(token) ||
    /^(?:S|SEC|M|MIN|H|D|W|MO)$/i.test(token)
  );
}

function isUsableSymbolToken(token) {
  if (!token || token.length < 2 || token.length > 40) return false;
  if (!/[A-Z]/.test(token)) return false;
  if (SYMBOL_STOPWORDS.has(token)) return false;
  if (isLikelyTimeframeToken(token)) return false;
  return true;
}

function normalizeSymbolParts(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return null;

  const compact = rawValue.trim().replace(/\s+/g, " ");
  const explicitPair = compact.match(
    /\b([A-Z0-9._!/-]{1,40}):([A-Z0-9._!/-]{1,40})(?=$|[^A-Z0-9._!/-])/,
  );

  if (explicitPair) {
    if (
      SYMBOL_STOPWORDS.has(explicitPair[1].toUpperCase()) ||
      SYMBOL_STOPWORDS.has(explicitPair[2].toUpperCase())
    ) {
      return null;
    }
    return {
      exchange: explicitPair[1].toUpperCase(),
      symbol: explicitPair[2].toUpperCase(),
    };
  }

  const upperCompact = compact.toUpperCase();
  const simpleLabel = upperCompact.match(
    /^([A-Z0-9._!/-]{2,40})(?:\s*(?:-|·)?\s*(?:\d+(?:S|M|H|D|W|MO)|S|SEC|M|MIN|H|D|W|MO))?$/,
  );
  const symbol = simpleLabel?.[1];

  return isUsableSymbolToken(symbol) ? { symbol } : null;
}

function isVisibleElement(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect || rect.width === 0 || rect.height === 0) return false;

  const style = window.getComputedStyle(element);
  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    Number(style.opacity || "1") > 0
  );
}

const SYMBOL_SEARCH_EXCLUSION_SELECTOR = [
  "input",
  "textarea",
  "select",
  "option",
  "form",
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
  "dialog",
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="search"]',
  "[aria-autocomplete]",
  '[data-name*="symbol-search" i]',
  '[data-name*="search-dialog" i]',
  '[class*="symbol-search" i]',
  '[class*="symbolSearch"]',
  '[class*="search-modal" i]',
  '[class*="searchDialog"]',
].join(", ");

function isSymbolSearchCandidate(element) {
  return Boolean(element?.closest?.(SYMBOL_SEARCH_EXCLUSION_SELECTOR));
}

function extractSymbolPartsFromElement(element) {
  if (
    !element ||
    isSymbolSearchCandidate(element) ||
    !isVisibleElement(element)
  ) {
    return null;
  }

  const candidates = [
    getTextContent(element),
    element.getAttribute?.("title"),
    element.getAttribute?.("aria-label"),
    element.getAttribute?.("data-symbol"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const symbolParts = normalizeSymbolParts(candidate);
    if (symbolParts) return symbolParts;
  }

  return null;
}

function findVisibleSymbolParts() {
  const selectors = [
    '[data-name="legend-source-title"]',
    '[data-name="legend-series-item"] [class*="title-"]',
    '[data-name*="legend"] [class*="ticker"]',
    '[data-name*="legend"] [class*="symbol"]',
    '[class*="ticker"]',
    '[class*="symbol"]',
    ".title-wrapper-S4V6J1lT",
    ".chart-gui-wrapper .title",
    ".title-3S9pZ9v9",
    ".subtitle-l31H9iuA",
  ];

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector)).slice(
      0,
      40,
    );
    for (const element of elements) {
      const symbolParts = extractSymbolPartsFromElement(element);
      if (symbolParts) return symbolParts;
    }
  }

  // Some TradingView layouts expose the committed symbol only as a chart
  // toolbar button. Keep that fallback narrow so search results and generic
  // labelled elements elsewhere in the page cannot masquerade as chart state.
  const compactElements = Array.from(
    document.querySelectorAll('button, [role="button"]'),
  ).slice(0, 300);
  for (const element of compactElements) {
    const text = getTextContent(element);
    if (text && text.length > 40) continue;

    const symbolParts = extractSymbolPartsFromElement(element);
    if (symbolParts) return symbolParts;
  }

  return null;
}

function normalizeChartHintText(rawValue, maxLength = 80) {
  if (!rawValue || typeof rawValue !== "string") return "";
  return rawValue
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function collectVisibleChartTexts(selectors, options = {}) {
  const maxItems = options.maxItems || 10;
  const maxLength = options.maxLength || 80;
  const matcher = options.matcher || (() => true);
  const values = [];
  const seen = new Set();

  selectors.forEach((selector) => {
    if (values.length >= maxItems) return;
    Array.from(document.querySelectorAll(selector))
      .slice(0, 60)
      .forEach((element) => {
        if (values.length >= maxItems || !isVisibleElement(element)) return;
        const candidates = [
          getTextContent(element),
          element.getAttribute?.("title"),
          element.getAttribute?.("aria-label"),
          element.getAttribute?.("data-name"),
        ];

        candidates.forEach((candidate) => {
          if (values.length >= maxItems) return;
          const value = normalizeChartHintText(candidate, maxLength);
          const key = value.toLowerCase();
          if (!value || seen.has(key) || !matcher(value)) return;
          seen.add(key);
          values.push(value);
        });
      });
  });

  return values;
}

function getVisibleIndicatorNames() {
  const noise =
    /^(?:open|high|low|close|ohlc|values?|settings|visibility|remove|more|symbol|compare|events?)$/i;
  const indicatorPattern =
    /\b(ema|sma|ma|rsi|macd|vwap|volume|supertrend|bollinger|bb|adx|atr|stoch|obv|ichimoku|pivot|session|profile)\b/i;
  return collectVisibleChartTexts(
    [
      '[data-name="legend-study-item"]',
      '[data-name*="legend"] [title]',
      '[data-name*="legend"] [aria-label]',
      '[class*="legend"] [title]',
    ],
    {
      maxItems: 8,
      matcher: (value) =>
        value.length >= 2 &&
        !noise.test(value) &&
        (indicatorPattern.test(value) || !normalizeSymbolParts(value)),
    },
  );
}

function getVisibleDrawingHints() {
  const drawingPattern =
    /\b(long position|short position|trend line|ray|horizontal line|vertical line|fib|fibonacci|pitchfork|brush|rectangle|text|arrow|path|parallel channel|position)\b/i;
  return collectVisibleChartTexts(["[aria-label]", "[title]", "[data-name]"], {
    maxItems: 8,
    matcher: (value) => drawingPattern.test(value),
  });
}

function getVisibleTradeMarkerHints() {
  const markerPattern =
    /\b(entry|stop|stop loss|take profit|tp|sl|risk reward|profit|loss|long position|short position|buy|sell)\b/i;
  return collectVisibleChartTexts(
    [
      "[aria-label]",
      "[title]",
      "[data-name]",
      '[class*="order"]',
      '[class*="position"]',
    ],
    {
      maxItems: 8,
      maxLength: 96,
      matcher: (value) => markerPattern.test(value),
    },
  );
}

/**
 * Structured, fail-closed detector for a TradingView Long/Short Position
 * drawing (or open-position badge) - the trigger for the plan-first local
 * opener ("I see a long plan on X. Want me to check it?"). Unlike
 * getVisibleDrawingHints/getVisibleTradeMarkerHints (loose situational text
 * used only as low-confidence prompt context), this returns null whenever
 * the direction is ambiguous, rather than guessing - the opener must never
 * show, and no backend/vision request must ever start, on an uncertain read.
 */
function getPositionEvidenceDirection(element) {
  const values = [
    getTextContent(element),
    element.getAttribute?.("title"),
    element.getAttribute?.("aria-label"),
    element.getAttribute?.("data-name"),
  ]
    .map((value) => normalizeChartHintText(value, 96))
    .filter(Boolean);
  const hasLong = values.some((value) => /\blong position\b/i.test(value));
  const hasShort = values.some((value) => /\bshort position\b/i.test(value));
  if (hasLong === hasShort) return null;
  return hasLong ? "LONG" : "SHORT";
}

function isPositionDrawingEvidenceElement(element) {
  if (!element || !isVisibleElement(element)) return false;
  const interactiveSelector =
    'button, [role="button"], [role="menuitem"], [role="menu"], [data-name*="toolbar"], [class*="toolbar"], [class*="menu"]';
  if (element.matches?.(interactiveSelector)) return false;
  if (element.closest?.(interactiveSelector)) return false;

  const chartEvidenceSelector =
    '[data-name*="drawing"], [data-name*="position"], [class*="drawing"], [class*="position"], [data-name*="pane"], [class*="chart-pane"], [class*="pane"]';
  return Boolean(element.matches?.(chartEvidenceSelector) || element.closest?.(chartEvidenceSelector));
}

function detectDeclaredPlan() {
  const candidates = Array.from(
    document.querySelectorAll(
      '[aria-label], [title], [data-name], [class*="position"]',
    ),
  ).slice(0, 240);
  const longEvidence = new Set();
  const shortEvidence = new Set();
  candidates.forEach((element) => {
    if (!isPositionDrawingEvidenceElement(element)) return;
    const direction = getPositionEvidenceDirection(element);
    if (direction === "LONG") longEvidence.add(element);
    if (direction === "SHORT") shortEvidence.add(element);
  });

  const hasLong = longEvidence.size > 0;
  const hasShort = shortEvidence.size > 0;
  // Both directions visible at once (e.g. two separate drawings, or a stale
  // tooltip) is exactly the ambiguous case to fail closed on - never guess.
  if (hasLong === hasShort) return null;

  const matchCount = hasLong ? longEvidence.size : shortEvidence.size;
  return {
    source: "detected",
    direction: hasLong ? "LONG" : "SHORT",
    confidence: matchCount >= 2 ? "high" : "medium",
  };
}

function getSituationalHints() {
  const indicatorNames = getVisibleIndicatorNames();
  const drawingTools = getVisibleDrawingHints();
  const tradeMarkers = getVisibleTradeMarkerHints();

  return {
    indicatorNames,
    drawingTools,
    tradeMarkers,
    domConfidence:
      tradeMarkers.length > 0 || drawingTools.length > 0 ? "medium" : "low",
  };
}

function normalizeTimeframe(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return null;

  const cleaned = rawValue.replace(/["']/g, "").trim().replace(/\s+/g, "");

  if (/^\d+$/.test(cleaned)) {
    const minutes = Number(cleaned);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    if (minutes < 60) return `${minutes}m`;
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes}m`;
  }

  let match = cleaned.match(/^(\d+)?([mMhHdDwW])$/);
  if (match) {
    const value = Number(match[1] || "1");
    const unit = match[2];

    if (!Number.isFinite(value) || value <= 0) return null;
    if (unit === "m") return `${value}m`;
    if (unit === "M") return `${value}M`;
    if (unit === "h" || unit === "H") return `${value}h`;
    if (unit === "d" || unit === "D") return `${value}D`;
    if (unit === "w" || unit === "W") return `${value}W`;
  }

  const lower = cleaned.toLowerCase();
  const wordMatch = lower.match(
    /^(\d+)?(min|mins|minute|minutes|hr|hrs|hour|hours|hourly|day|days|daily|wk|wks|week|weeks|weekly|mo|mon|month|months|monthly)$/,
  );
  if (wordMatch) {
    const value = Number(wordMatch[1] || "1");
    const unit = wordMatch[2];

    if (["min", "mins", "minute", "minutes"].includes(unit)) return `${value}m`;
    if (["hr", "hrs", "hour", "hours", "hourly"].includes(unit))
      return `${value}h`;
    if (["day", "days", "daily"].includes(unit)) return `${value}D`;
    if (["wk", "wks", "week", "weeks", "weekly"].includes(unit))
      return `${value}W`;
    if (["mo", "mon", "month", "months", "monthly"].includes(unit))
      return `${value}M`;
  }

  return null;
}

function getUrlChartParts() {
  try {
    const url = new URL(window.location.href);
    return {
      symbol:
        url.searchParams.get("symbol") ||
        url.searchParams.get("ticker") ||
        undefined,
      interval:
        url.searchParams.get("interval") ||
        url.searchParams.get("timeframe") ||
        undefined,
    };
  } catch (error) {
    console.warn("ChartMentor: Failed to parse TradingView URL", error);
    return {};
  }
}

function getChartContext() {
  const symbolElement =
    document.querySelector(".title-wrapper-S4V6J1lT") ||
    document.querySelector(
      '[data-name="legend-series-item"] [class*="title-"]',
    ) ||
    document.querySelector(".chart-gui-wrapper .title") ||
    document.querySelector('[data-name="legend-source-title"]') ||
    document.querySelector(".title-3S9pZ9v9") ||
    document.querySelector(".subtitle-l31H9iuA");

  let localStateInterval = null;
  try {
    localStateInterval = localStorage.getItem(
      "tradingview.editchart.model.interval",
    );
  } catch (e) {}

  const timeframeElement =
    document.querySelector('button[aria-label="Change interval"]') ||
    document.querySelector('button[class*="isActive-"][data-value]') ||
    document.querySelector('button[class*="isActive-"]') ||
    document.querySelector(".button-merBkM5y[data-value]") ||
    document.querySelector('[data-name="timeframe-button"]') ||
    document.querySelector(".chart-gui-wrapper .timeframe") ||
    document.querySelector(".timeframe-3S9pZ9v9");

  const urlParts = getUrlChartParts();
  const domSymbolParts =
    findVisibleSymbolParts() ||
    normalizeSymbolParts(getTextContent(symbolElement));
  const titleSymbolParts = normalizeSymbolParts(document.title);
  const urlSymbolParts = normalizeSymbolParts(urlParts.symbol);

  const localStorageTimeframe = normalizeTimeframe(localStateInterval);
  const domTimeframe = normalizeTimeframe(
    timeframeElement?.getAttribute("data-value") ||
      getTextContent(timeframeElement),
  );
  const urlTimeframe = normalizeTimeframe(urlParts.interval);
  const titleTimeframeMatch = document.title.match(
    /\b(\d+\s*(?:m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|wk|week|weeks|mo|month|months)|\d+[MHDW])\b/i,
  );
  const titleTimeframe = normalizeTimeframe(titleTimeframeMatch?.[1] || "");

  const symbolParts = domSymbolParts ||
    titleSymbolParts ||
    urlSymbolParts || { symbol: "UNKNOWN" };
  const symbolSource = domSymbolParts
    ? "dom"
    : titleSymbolParts
      ? "title"
      : urlSymbolParts
        ? "url"
        : undefined;

  const timeframe =
    localStorageTimeframe ||
    domTimeframe ||
    urlTimeframe ||
    titleTimeframe ||
    "1h";

  let timeframeSource = undefined;
  if (localStorageTimeframe) timeframeSource = "localstorage";
  else if (domTimeframe) timeframeSource = "dom";
  else if (urlTimeframe) timeframeSource = "url";
  else if (titleTimeframe) timeframeSource = "title";

  return {
    symbol: symbolParts.symbol || "UNKNOWN",
    timeframe,
    exchange: symbolParts.exchange,
    symbolSource,
    timeframeSource,
    urlParts,
    situationalHints: getSituationalHints(),
    detectedPlan: detectDeclaredPlan(),
  };
}

const symbolConfidence = {
  recentReadings: [],
  maxHistory: 5,
  lastStable: null,
};

function updateConfidence(newSymbol) {
  if (!newSymbol || newSymbol === "UNKNOWN") {
    symbolConfidence.recentReadings.push(null);
  } else {
    symbolConfidence.recentReadings.push(newSymbol);
  }
  if (symbolConfidence.recentReadings.length > symbolConfidence.maxHistory) {
    symbolConfidence.recentReadings.shift();
  }
  const valid = symbolConfidence.recentReadings.filter(Boolean);
  if (valid.length === 0) {
    symbolConfidence.lastStable = null;
    return "none";
  }
  const unique = [...new Set(valid)];
  if (unique.length === 1 && valid.length >= 2) {
    symbolConfidence.lastStable = unique[0];
    return "high";
  }
  if (unique.length === 1) return "medium";
  return "low";
}

function getChartContextWithConfidence() {
  const ctx = getChartContext();
  const confidence = updateConfidence(ctx.symbol);
  return { ...ctx, symbolConfidence: confidence };
}

let chartChangeObserver = null;
let chartChangeDebounce = null;
let lastEmittedChartContext = "";

function emitChartContextChange() {
  const ctx = getChartContextWithConfidence();
  const signature = [
    ctx.symbol || "UNKNOWN",
    ctx.timeframe || "",
    ctx.symbolConfidence || "none",
    ctx.detectedPlan ? `${ctx.detectedPlan.direction}:${ctx.detectedPlan.confidence}` : "none",
  ].join("|");
  if (signature === lastEmittedChartContext) return;

  lastEmittedChartContext = signature;
  window.dispatchEvent(
    new CustomEvent("chartmentor:symbolChanged", { detail: ctx }),
  );
}

function startChartChangeObserver() {
  if (chartChangeObserver) return;
  const target = document.documentElement;
  if (!target) return;

  chartChangeObserver = new MutationObserver(() => {
    if (chartChangeDebounce) clearTimeout(chartChangeDebounce);
    chartChangeDebounce = setTimeout(() => {
      emitChartContextChange();
    }, 300);
  });
  chartChangeObserver.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  emitChartContextChange();
}
