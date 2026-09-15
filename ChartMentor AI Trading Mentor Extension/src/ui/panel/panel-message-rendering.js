function clearStaleAnalysisErrors() {
  elements.chatMessages
    ?.querySelectorAll('[data-analysis-error="true"]')
    .forEach((messageEl) => messageEl.remove());
  state.messages = state.messages.filter((message) => !message.isAnalysisError);
}

function renderMessage(message) {
  // Remove welcome message if it exists
  const welcome = elements.chatMessages.querySelector(".welcome-message");
  if (welcome) welcome.remove();
  clearReviewPlaceholder();
  setReviewContentMode(true);

  const messageEl = document.createElement("div");
  messageEl.className = `message ${message.role}`;
  const isConversionPrompt = Boolean(message.isUpgrade);
  if (message.isAuthRequired) {
    messageEl.dataset.authRequiredMessage = "true";
  }
  if (message.isAnalysisError) {
    messageEl.dataset.analysisError = "true";
  }
  if (message.isSymbolClarification) {
    messageEl.dataset.symbolClarification = "true";
  }
  if (message.isUpgrade && message.gateType) {
    messageEl.dataset.upgradeGate = message.gateType;
  }
  if (isConversionPrompt) {
    messageEl.dataset.conversionPrompt = "true";
  }
  if (message.responseReady) {
    messageEl.classList.add("response-ready");
  }
  // rawText is a transient reveal mode. Older persisted assistant messages may
  // still carry it, but restored answers need semantic Markdown formatting.
  const shouldRenderRawText = Boolean(
    message.rawText && (!message.isRestored || message.role !== "assistant"),
  );
  const contentEl = document.createElement("div");
  contentEl.className = "message-content";
  if (shouldRenderRawText) {
    contentEl.classList.add("raw-text");
    contentEl.textContent = String(message.content || "");
  } else {
    const renderedStructuredFollowUp = Boolean(
      message.role === "assistant" &&
        renderStructuredFollowUpContent(
          contentEl,
          message.structuredContent || message.structured_content,
        ),
    );
    if (!renderedStructuredFollowUp) {
      // Use textContent in formatMessageContent for security, then add Markdown-lite display.
      const formattedContent = formatMessageContent(message.content);
      contentEl.innerHTML = formattedContent;
    }
  }

  messageEl.appendChild(contentEl);

  if (message.isUpgrade || message.isAuthRequired) {
    const actionEl = document.createElement("div");
    actionEl.className = "chat-action-card";

    const primaryBtn = document.createElement("button");
    primaryBtn.className = "chat-action-btn primary";
    primaryBtn.textContent = message.isAuthRequired
      ? "Log in again"
      : message.ctaLabel || "Keep checking";
    primaryBtn.addEventListener("click", () => {
      if (message.isSafetyPause) {
        void trackPanelEvent("safety_pause_account_opened", {
          source: "extension",
        });
        window.open(message.upgradeUrl || ACCOUNT_URL, "_blank");
        return;
      }
      if (message.isUpgrade) {
        trackPanelEvent("upgrade_cta_clicked", {
          source: "extension",
          gateType: message.gateType || null,
        });
      }
      if (message.isAuthRequired) {
        window.open(buildSignupUrl(), "_blank");
        return;
      }
      void startDollarTrialCheckoutFromPanel({
        button: primaryBtn,
        gateType: message.gateType,
        source: message.checkoutSource,
        fallbackUrl: message.upgradeUrl || LIMIT_GATE_PRICING_URL,
      });
    });

    actionEl.appendChild(primaryBtn);
    messageEl.appendChild(actionEl);
  }

  elements.chatMessages.appendChild(messageEl);
  if (message.role === "assistant" && message.responseReady) {
    prepareAssistantResponseReveal(messageEl, {
      restored: message.isRestored === true,
    });
  }

  return messageEl;
}

function restorePersistedChatMessages(chatMessages, options = {}) {
  const persistedMessages = options.full
    ? (Array.isArray(chatMessages) ? chatMessages : [])
        .map((message) =>
          normalizeDurableConversationMessage(
            message,
            message?.remoteSynced !== false,
          ),
        )
        .filter(Boolean)
    : getPersistableChatMessages(chatMessages);
  if (persistedMessages.length === 0) return;

  persistedMessages.forEach((message) => {
    const restoredMessage = { ...message, isRestored: true };
    state.messages.push(restoredMessage);
    renderMessage(restoredMessage);
  });
}

function normalizeScreenshotPayload(value) {
  if (typeof value === "string") {
    return {
      dataUrl: value,
      captureMetadata: null,
    };
  }

  if (value && typeof value === "object") {
    const dataUrl =
      typeof value.dataUrl === "string"
        ? value.dataUrl
        : typeof value.screenshot === "string"
          ? value.screenshot
          : null;

    return {
      dataUrl,
      captureMetadata: value.captureMetadata || value.metadata || null,
    };
  }

  return {
    dataUrl: null,
    captureMetadata: null,
  };
}

function normalizeFingerprintText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getChartFingerprintContext(chartInfo = {}, scanSettings = {}) {
  const hints = chartInfo.situationalHints || {};
  const declaredPlan = scanSettings.declaredPlan || {};
  const normalizeList = (values) =>
    Array.isArray(values)
      ? values.map(normalizeFingerprintText).filter(Boolean).sort()
      : [];

  return {
    symbol: normalizeFingerprintText(chartInfo.symbol),
    exchange: normalizeFingerprintText(chartInfo.exchange),
    timeframe: normalizeFingerprintText(chartInfo.timeframe),
    symbolSource: normalizeFingerprintText(chartInfo.symbolSource),
    timeframeSource: normalizeFingerprintText(chartInfo.timeframeSource),
    indicators: normalizeList(hints.indicatorNames),
    drawings: normalizeList(hints.drawingTools),
    tradeMarkers: normalizeList(hints.tradeMarkers),
    domConfidence: normalizeFingerprintText(hints.domConfidence),
    reviewMode: normalizeFingerprintText(scanSettings.reviewMode),
    setupType: normalizeFingerprintText(scanSettings.setupType),
    mentorVoice: normalizeFingerprintText(scanSettings.mentorVoice),
    responseLength: normalizeFingerprintText(scanSettings.responseLength),
    customLensConfigured: Boolean(scanSettings.hasCustomLens),
    declaredPlan: {
      source: normalizeFingerprintText(declaredPlan.source),
      direction: normalizeFingerprintText(declaredPlan.direction),
      entry: normalizeFingerprintText(declaredPlan.entry),
      stop: normalizeFingerprintText(declaredPlan.stop),
      target: normalizeFingerprintText(declaredPlan.target),
    },
  };
}

function createQuantizedImageFingerprint(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const width = 32;
        const height = 20;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          resolve(null);
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let hash = 2166136261;
        for (let index = 0; index < pixels.length; index += 4) {
          // Quantization filters out tiny capture noise while preserving chart structure.
          hash ^= Math.floor(pixels[index] / 16);
          hash = Math.imul(hash, 16777619);
          hash ^= Math.floor(pixels[index + 1] / 16);
          hash = Math.imul(hash, 16777619);
          hash ^= Math.floor(pixels[index + 2] / 16);
          hash = Math.imul(hash, 16777619);
        }
        resolve((hash >>> 0).toString(16).padStart(8, "0"));
      } catch (error) {
        console.warn("ChartMentor: Could not fingerprint chart capture", error);
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

async function buildChartFingerprint(
  chartInfo,
  screenshotPayload,
  scanSettings = {},
) {
  const normalizedScreenshot = normalizeScreenshotPayload(screenshotPayload);
  const visualFingerprint = await createQuantizedImageFingerprint(
    normalizedScreenshot.dataUrl,
  );
  if (!visualFingerprint) return null;

  return JSON.stringify({
    version: CHART_FINGERPRINT_VERSION,
    context: getChartFingerprintContext(chartInfo, scanSettings),
    visualFingerprint,
  });
}

function getCachedScanCard(fingerprint) {
  if (!fingerprint || !elements.chatMessages) return null;
  return (
    Array.from(
      elements.chatMessages.querySelectorAll(
        ".review-card, .setup-scan-card, .chart-quality-blocked-card",
      ),
    ).find((card) => card.dataset.chartFingerprint === fingerprint) || null
  );
}

function markLatestScanCard(fingerprint) {
  if (!fingerprint || !elements.chatMessages) return;
  const cards = elements.chatMessages.querySelectorAll(
    ".review-card, .setup-scan-card, .chart-quality-blocked-card",
  );
  const latestCard = cards[cards.length - 1];
  if (latestCard) latestCard.dataset.chartFingerprint = fingerprint;
}

function renderCachedScan(snapshot) {
  if (!snapshot?.analysisData) return false;

  const existingCard = getCachedScanCard(snapshot.fingerprint);
  if (existingCard) {
    scrollPanelChildIntoView(existingCard, { behavior: "auto" });
    return true;
  }

  const analysisData = snapshot.analysisData;
  if (snapshot.renderType === "chart_quality_blocked") {
    renderChartQualityBlockedCard(analysisData);
  } else {
    renderSetupScanCard(analysisData);
  }
  markLatestScanCard(snapshot.fingerprint);
  return true;
}

function rememberLastScanSnapshot(snapshot) {
  if (!snapshot?.fingerprint || !snapshot.analysisData) return;
  state.lastScanSnapshot = {
    fingerprint: snapshot.fingerprint,
    renderType: snapshot.renderType || "setup",
    analysisData: snapshot.analysisData,
    historyId: snapshot.historyId || null,
  };
}

function finishAnalysisUi() {
  state.isAnalyzing = false;
  stopLoadingSequence();
  if (elements.analyzeBtn) {
    elements.analyzeBtn.classList.remove("analyzing");
  }
  updateReviewModeUI();
}

/**
 * Format message content safely
 * Encodes dynamic content to prevent XSS and converts newlines to <br>
 */
const SETUP_SCAN_EMOJI_RULES = [
  {
    emoji: "⚠️",
    pattern:
      /\b(no[- ]?trade|no clean|no safe|avoid|warning|trap|problem|blocked|clutter|unreadable)\b/i,
  },
  { emoji: "🧭", pattern: /\b(context|bias|trend|structure|market)\b/i },
  {
    emoji: "📍",
    pattern:
      /\b(location|position|zone|zones|level|levels|support|resistance|area)\b/i,
  },
  { emoji: "🎯", pattern: /\b(trigger|entry|setup|idea|candidate)\b/i },
  { emoji: "🛑", pattern: /\b(invalidation|invalidates|cancel|stop|risk)\b/i },
  { emoji: "🔔", pattern: /\b(alert|watch|wait|re-?check|confirmation)\b/i },
  { emoji: "✅", pattern: /\b(target|take profit|tp)\b/i },
];

// Detects ANY leading pictographic emoji the model already produced (not
// just the curated SETUP_SCAN_EMOJI_RULES set below), so a fallback emoji
// is never prepended in front of one the response already supplied - that
// previously produced doubled headings like "## 🧭 🎨 Bias".
function lineHasSetupScanEmoji(line) {
  const stripped = String(line || "")
    .trim()
    .replace(/^(?:#{1,3}\s*|[-*•]\s+|\d+\.\s*)/, "")
    .replace(/^\*\*/, "");
  return /^\p{Extended_Pictographic}/u.test(stripped);
}

function getSetupScanEmojiForLine(line) {
  const rawLine = String(line || "");
  const isHeading = /^\s*#{1,3}\s+/.test(rawLine);
  const isBoldLabel = /^\s*(?:[-*•]\s*|\d+\.\s*)?\*\*[^*]{2,48}\*\*/.test(
    rawLine,
  );
  const isNumberedLabel = /^\s*\d+\.\s+[^:]{2,48}:/.test(rawLine);
  const withoutMarker = rawLine.replace(
    /^\s*(?:#{1,3}\s*|[-*•]\s+|\d+\.\s*)/,
    "",
  );
  const plainLine = withoutMarker.replace(/\*\*/g, "").trim();
  const labelMatch = plainLine.match(/^([^:–-]{2,48})(?::|–|-)/);

  if (!isHeading && !isBoldLabel && !isNumberedLabel && !labelMatch) return "";

  const labelText = (labelMatch ? labelMatch[1] : plainLine)
    .replace(/\*\*/g, "")
    .replace(/[:\-–].*$/, "")
    .trim();

  if (!labelText) return "";
  const match = SETUP_SCAN_EMOJI_RULES.find(({ pattern }) =>
    pattern.test(labelText),
  );
  return match ? match.emoji : "";
}
