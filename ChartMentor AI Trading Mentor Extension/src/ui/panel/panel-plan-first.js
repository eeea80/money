/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Plan-first activation
 *
 * Local, no-backend-call opener for a detected TradingView Long/Short
 * Position box, plus the manual-plan fallback form. Both plan-carrying paths
 * end the same way: startAnalysis(null, { declaredPlan }). When nothing is
 * detected locally, the backend vision proposal flow can still recover the
 * plan from the screenshot.
 */

const PLAN_FIRST_MIN_CONFIDENCE = new Set(["medium", "high"]);
const planFirstLocal = {
  lastSignature: null,
  dismissedSignature: null,
  activeDetectedPlan: null,
  manualDirection: null,
  reviewPending: false,
};

// The element focused when the modal opened, so closing it (cancel, submit,
// or Escape) can put focus back where the user actually was instead of
// dropping it to the document body.
let manualPlanPriorFocusElement = null;
// setupPlanFirstListeners only runs once in production (DOMContentLoaded
// fires once), but this guard keeps a hypothetical re-invocation from
// stacking a second focus-trap listener on the modal.
let manualPlanKeydownBound = false;

function cachePlanFirstElements() {
  elements.manualPlanModal = document.getElementById("manual-plan-modal");
  elements.manualPlanLongBtn = document.getElementById("manual-plan-long-btn");
  elements.manualPlanShortBtn = document.getElementById(
    "manual-plan-short-btn",
  );
  elements.manualPlanEntry = document.getElementById("manual-plan-entry");
  elements.manualPlanStop = document.getElementById("manual-plan-stop");
  elements.manualPlanTarget = document.getElementById("manual-plan-target");
  elements.manualPlanError = document.getElementById("manual-plan-error");
  elements.manualPlanSubmitBtn = document.getElementById(
    "manual-plan-submit-btn",
  );
  elements.manualPlanCancelBtn = document.getElementById(
    "manual-plan-cancel-btn",
  );
}

function planSignature(plan, symbol, timeframe) {
  if (!plan) return null;
  return [symbol || "?", timeframe || "?", plan.direction, plan.confidence].join(
    "|",
  );
}

function isReliablePlanChartContext(data) {
  const confidence = data?.symbolConfidence;
  const symbol = normalizePanelText(data?.symbol);
  const timeframe = normalizePanelText(data?.timeframe);
  return Boolean(
    symbol &&
      timeframe &&
      !isPlaceholderSymbol(symbol) &&
      (confidence === "medium" || confidence === "high"),
  );
}

function hidePlanFirstBanner() {
  elements.chatMessages
    ?.querySelector('[data-live-mentor="detected-plan"]')
    ?.remove();
  planFirstLocal.activeDetectedPlan = null;
}

function restorePlanFirstIdleMessage() {
  if (
    !elements.chatMessages ||
    state.isAnalyzing ||
    state.currentAnalysis ||
    state.messages.length > 0 ||
    elements.chatMessages.children.length > 0
  ) {
    return;
  }
  setReviewContentMode(false);
  elements.chatMessages.innerHTML = getEmptyReviewStateHtml();
}

function renderDetectedPlanPrompt({ text, signature }) {
  if (!elements.chatMessages) return;
  const current = elements.chatMessages.querySelector(
    '[data-live-mentor="detected-plan"]',
  );
  if (current?.dataset.planSignature === signature) return;
  current?.remove();
  clearReviewPlaceholder();
  setReviewContentMode(true);

  const prompt = document.createElement("div");
  prompt.className = "message assistant live-mentor-message";
  prompt.dataset.liveMentor = "detected-plan";
  prompt.dataset.planSignature = signature;

  const status = document.createElement("div");
  status.className = "live-mentor-status";
  status.innerHTML =
    '<span class="live-mentor-dot" aria-hidden="true"></span><span>Chart changed</span>';
  prompt.appendChild(status);

  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = text;
  prompt.appendChild(content);

  const actions = document.createElement("div");
  actions.className = "live-mentor-actions";
  const review = document.createElement("button");
  review.type = "button";
  review.className = "live-mentor-action primary";
  review.textContent = "Review it";
  review.addEventListener("click", async () => {
    review.disabled = true;
    await startDetectedPlanReview();
  });
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "live-mentor-action";
  dismiss.textContent = "Not now";
  dismiss.addEventListener("click", () => {
    planFirstLocal.dismissedSignature = planFirstLocal.lastSignature;
    hidePlanFirstBanner();
    restorePlanFirstIdleMessage();
  });
  actions.append(review, dismiss);
  prompt.appendChild(actions);
  elements.chatMessages.appendChild(prompt);
  scrollReviewToEnd();
}

/**
 * Called on every chart-context update (symbol change, timeframe change, or
 * a redetected plan). Chart-change cancellation: any change that no longer
 * matches the currently-shown plan's signature hides the banner immediately
 * - it never persists across a chart the user has moved away from.
 */
function handlePlanFirstChartContextUpdate(data) {
  if (!elements.chatMessages) return;
  if (state.isAnalyzing) {
    hidePlanFirstBanner();
    return;
  }

  const plan = data?.detectedPlan;
  const symbol = normalizePanelText(data?.symbol);
  const timeframe = normalizePanelText(data?.timeframe);
  const isConfident = Boolean(
    isReliablePlanChartContext(data) &&
      plan?.direction &&
      PLAN_FIRST_MIN_CONFIDENCE.has(plan.confidence),
  );

  if (!isConfident) {
    hidePlanFirstBanner();
    restorePlanFirstIdleMessage();
    return;
  }

  const signature = planSignature(plan, symbol, timeframe);

  if (signature === planFirstLocal.dismissedSignature) {
    hidePlanFirstBanner();
    restorePlanFirstIdleMessage();
    return;
  }

  planFirstLocal.activeDetectedPlan = {
    source: "detected",
    direction: plan.direction,
  };

  if (signature !== planFirstLocal.lastSignature) {
    planFirstLocal.lastSignature = signature;
    void trackPanelEvent("position_box_detected", {
      direction: plan.direction,
      confidence: plan.confidence,
      symbol,
      timeframe,
    });
  }

  const directionLabel = plan.direction === "SHORT" ? "short" : "long";
  const chartLabel = [symbol, timeframe].filter(Boolean).join(" ");
  renderDetectedPlanPrompt({
    signature,
    text: chartLabel
      ? `I see a ${directionLabel} plan on ${chartLabel}. Want me to challenge it?`
      : `I see a ${directionLabel} plan on this chart. Want me to challenge it?`,
  });
}

async function startDetectedPlanReview(preCapturedScreenshot = null) {
  if (planFirstLocal.reviewPending) return false;
  const expectedSignature = planFirstLocal.lastSignature;
  if (!expectedSignature || !planFirstLocal.activeDetectedPlan) {
    openManualPlanModal();
    return false;
  }

  planFirstLocal.reviewPending = true;
  switchTab("review");
  showLoading(true);
  showAnalysisTypingBubble();
  try {
    const latestContext = await getChartInfo();
    const latestSignature = planSignature(
      latestContext?.detectedPlan,
      normalizePanelText(latestContext?.symbol),
      normalizePanelText(latestContext?.timeframe),
    );
    const declaredPlan = planFirstLocal.activeDetectedPlan;
    if (!declaredPlan || latestSignature !== expectedSignature) {
      handlePlanFirstChartContextUpdate(latestContext);
      return false;
    }
    hidePlanFirstBanner();
    await startAnalysis(preCapturedScreenshot, { declaredPlan });
    return true;
  } catch (error) {
    hidePlanFirstBanner();
    restorePlanFirstIdleMessage();
    console.debug("ChartMentor: Position plan revalidation failed", error);
    return false;
  } finally {
    planFirstLocal.reviewPending = false;
    if (!state.isAnalyzing) showLoading(false);
  }
}

async function requestPlanFirstReview(preCapturedScreenshot = null) {
  if (
    state.isAnalyzing ||
    state.isClearingSession ||
    planFirstLocal.reviewPending
  )
    return;

  if (!state.isAuthenticated) {
    window.open(
      buildSignupUrl({ signup_context: "extension_plan_review" }),
      "_blank",
    );
    return;
  }

  if (planFirstLocal.activeDetectedPlan) {
    await startDetectedPlanReview(preCapturedScreenshot);
    return;
  }

  // The DOM detector only sees the rare text-rendered Position box, so a
  // miss here is the norm, not an error: run the review anyway and let the
  // backend's vision pass read the box off the screenshot. The event name
  // stays put for funnel continuity; the payload records the new outcome.
  void trackPanelEvent("plan_required_before_review", {
    source: "extension_primary_action",
    reason: "deferred_to_vision_detection",
  });
  await startAnalysis(preCapturedScreenshot);
}

function setupPlanFirstListeners() {
  elements.manualPlanLongBtn?.addEventListener("click", () =>
    selectManualPlanDirection("LONG"),
  );
  elements.manualPlanShortBtn?.addEventListener("click", () =>
    selectManualPlanDirection("SHORT"),
  );

  elements.manualPlanCancelBtn?.addEventListener("click", () => {
    closeManualPlanModal();
  });

  elements.manualPlanSubmitBtn?.addEventListener("click", () => {
    submitManualPlan();
  });

  if (!manualPlanKeydownBound && elements.manualPlanModal) {
    elements.manualPlanModal.addEventListener(
      "keydown",
      handleManualPlanModalKeydown,
    );
    manualPlanKeydownBound = true;
  }
}

// Cached controls in the order they should be reachable by Tab, used both to
// pick where focus lands on open and to trap Tab/Shift+Tab inside the dialog.
function getManualPlanFocusOrder() {
  return [
    elements.manualPlanLongBtn,
    elements.manualPlanShortBtn,
    elements.manualPlanEntry,
    elements.manualPlanStop,
    elements.manualPlanTarget,
    elements.manualPlanSubmitBtn,
    elements.manualPlanCancelBtn,
  ].filter(Boolean);
}

function focusManualPlanElement(element) {
  if (element && typeof element.focus === "function") element.focus();
}

/**
 * A prefilled direction means the user already answered the first question,
 * so focus skips straight to the first level field instead of re-asking a
 * choice that's already made.
 */
function focusManualPlanInitialControl(prefilled) {
  const initial = prefilled?.prefilledDirection
    ? elements.manualPlanEntry
    : elements.manualPlanLongBtn;
  focusManualPlanElement(initial || getManualPlanFocusOrder()[0]);
}

/**
 * The trap listener lives on the modal itself and relies on Tab's native
 * bubbling: event.target is always the element that actually had focus when
 * the key was pressed, so no separate document.activeElement bookkeeping is
 * needed here.
 */
function handleManualPlanModalKeydown(event) {
  if (
    !elements.manualPlanModal ||
    elements.manualPlanModal.classList?.contains("hidden")
  )
    return;

  if (event.key === "Escape") {
    event.preventDefault?.();
    closeManualPlanModal();
    return;
  }

  if (event.key !== "Tab") return;
  const focusOrder = getManualPlanFocusOrder();
  if (focusOrder.length === 0) return;
  const activeIndex = focusOrder.indexOf(event.target);

  if (event.shiftKey) {
    if (activeIndex <= 0) {
      event.preventDefault?.();
      focusManualPlanElement(focusOrder[focusOrder.length - 1]);
    }
  } else if (activeIndex === -1 || activeIndex === focusOrder.length - 1) {
    event.preventDefault?.();
    focusManualPlanElement(focusOrder[0]);
  }
}

/**
 * `prefill` carries whatever a vision-detected plan actually resolved to:
 * direction plus any level the screenshot pass could read. Correcting a
 * misread then costs one edited field instead of four retyped ones. Values
 * are round-tripped through parseManualPlanPrice so the input holds exactly
 * what submitManualPlan will parse back out, and anything unreadable is left
 * blank rather than guessed.
 */
function openManualPlanModal(prefill = null) {
  if (!elements.manualPlanModal) return;
  manualPlanPriorFocusElement =
    document.activeElement &&
    typeof document.activeElement.focus === "function"
      ? document.activeElement
      : null;
  planFirstLocal.manualDirection = null;
  elements.manualPlanLongBtn?.classList.remove("selected");
  elements.manualPlanShortBtn?.classList.remove("selected");
  if (elements.manualPlanEntry) elements.manualPlanEntry.value = "";
  if (elements.manualPlanStop) elements.manualPlanStop.value = "";
  if (elements.manualPlanTarget) elements.manualPlanTarget.value = "";
  setManualPlanError(null);
  const prefilled = applyManualPlanPrefill(prefill);
  elements.manualPlanModal.classList.remove("hidden");
  elements.manualPlanModal.setAttribute("aria-hidden", "false");
  focusManualPlanInitialControl(prefilled);
  void trackPanelEvent("manual_plan_started", prefilled);
}

function applyManualPlanPrefill(prefill) {
  const applied = { prefilledDirection: false, prefilledLevels: 0 };
  if (!prefill || typeof prefill !== "object") return applied;
  if (prefill.direction === "LONG" || prefill.direction === "SHORT") {
    selectManualPlanDirection(prefill.direction);
    applied.prefilledDirection = true;
  }
  [
    ["entry", elements.manualPlanEntry],
    ["stop", elements.manualPlanStop],
    ["target", elements.manualPlanTarget],
  ].forEach(([field, input]) => {
    // Gate on the same parser submitManualPlan uses, but write the value as
    // read: 4152.70 stays 4152.70 in the box instead of collapsing to 4152.7
    // and no longer matching the price the user is looking at on the chart.
    const raw = normalizePanelText(prefill[field]);
    if (!input || !raw || !parseManualPlanPrice(raw)) return;
    input.value = raw;
    applied.prefilledLevels += 1;
  });
  return applied;
}

function closeManualPlanModal() {
  elements.manualPlanModal?.classList.add("hidden");
  elements.manualPlanModal?.setAttribute("aria-hidden", "true");
  const restoreTarget = manualPlanPriorFocusElement;
  manualPlanPriorFocusElement = null;
  focusManualPlanElement(restoreTarget);
}

function selectManualPlanDirection(direction) {
  planFirstLocal.manualDirection = direction;
  elements.manualPlanLongBtn?.classList.toggle("selected", direction === "LONG");
  elements.manualPlanShortBtn?.classList.toggle(
    "selected",
    direction === "SHORT",
  );
}

function setManualPlanError(message) {
  if (!elements.manualPlanError) return;
  if (!message) {
    elements.manualPlanError.textContent = "";
    elements.manualPlanError.classList.add("hidden");
    return;
  }
  elements.manualPlanError.textContent = message;
  elements.manualPlanError.classList.remove("hidden");
}

function parseManualPlanPrice(rawValue) {
  let clean = String(rawValue || "")
    .trim()
    .replace(/[\s']/g, "");
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    clean = clean.split(groupingSeparator).join("");
    if (decimalSeparator === ",") clean = clean.replace(",", ".");
  } else if (lastComma >= 0) {
    const parts = clean.split(",");
    clean = `${parts.slice(0, -1).join("")}.${parts.at(-1)}`;
  }
  if (!clean || !/^\d+(?:\.\d+)?$/.test(clean)) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : null;
}

function isManualPlanGeometryValid(direction, entry, stop, target) {
  const entryPrice = Number(entry);
  const stopPrice = Number(stop);
  const targetPrice = Number(target);
  if (![entryPrice, stopPrice, targetPrice].every(Number.isFinite)) return false;
  return direction === "LONG"
    ? stopPrice < entryPrice && entryPrice < targetPrice
    : targetPrice < entryPrice && entryPrice < stopPrice;
}

/**
 * A manual plan can only start a review when every field is present and
 * valid - direction, entry, stop, target. Any missing/invalid field blocks
 * submission client-side (the backend re-validates and fails closed too).
 */
function submitManualPlan() {
  const direction = planFirstLocal.manualDirection;
  const entry = parseManualPlanPrice(elements.manualPlanEntry?.value);
  const stop = parseManualPlanPrice(elements.manualPlanStop?.value);
  const target = parseManualPlanPrice(elements.manualPlanTarget?.value);

  if (!direction) {
    setManualPlanError("Choose long or short.");
    return;
  }
  if (!entry || !stop || !target) {
    setManualPlanError("Entry, stop, and target must all be numeric prices.");
    return;
  }
  if (!isManualPlanGeometryValid(direction, entry, stop, target)) {
    setManualPlanError(
      direction === "LONG"
        ? "For a long plan: stop < entry < target."
        : "For a short plan: target < entry < stop.",
    );
    return;
  }

  setManualPlanError(null);
  closeManualPlanModal();
  void trackPanelEvent("manual_plan_completed", { direction });
  void startAnalysis(null, {
    declaredPlan: { source: "manual", direction, entry, stop, target },
  });
}

document.addEventListener("DOMContentLoaded", () => {
  cachePlanFirstElements();
  setupPlanFirstListeners();
});

window.ChartMentorPlanFirst = {
  handleChartContextUpdate: handlePlanFirstChartContextUpdate,
  requestReview: requestPlanFirstReview,
};
