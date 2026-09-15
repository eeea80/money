function getWatchAlertLevel(watchCondition) {
  const explicit = normalizeExactScanPrice(
    watchCondition?.alertLevel ||
      watchCondition?.level ||
      watchCondition?.entry,
  );
  return (
    explicit ||
    normalizeExactScanPrice(
      getFirstVisiblePriceLevel(watchCondition?.trigger || ""),
    )
  );
}

const DETECTED_PLAN_PRICE = /^\d+(?:\.\d+)?$/;

/**
 * The vision pass reads the Position box off the screenshot and reports it on
 * visualPreflight.detectedPlan. That read is a PROPOSAL, never an accepted
 * plan: it becomes a real declaredPlan only on the next request, after the
 * user confirms it here. Returns null when there is nothing to ask about -
 * either the response predates the field, or the request already carried a
 * user-supplied plan.
 *
 * The Position drawing carries no text labels, so the two confidences are
 * genuinely independent: direction comes from fill-colour geometry and is
 * usually solid, while the levels are inferred by aligning box edges against
 * a crowded price axis and routinely come back partial or shaky. Missing and
 * low-confidence prices are the normal case here, not the edge case.
 */
function getDetectedPlanPrompt(analysisData) {
  const detected = analysisData?.visualPreflight?.detectedPlan;
  if (!detected || typeof detected !== "object") return null;
  if (normalizeStoredDeclaredPlan(analysisData?.declaredPlan)) return null;
  const direction =
    detected.direction === "LONG" || detected.direction === "SHORT"
      ? detected.direction
      : null;
  // `present: true` without a direction violates the contract; treat it the
  // same as "no box" rather than proposing a directionless plan.
  if (detected.present !== true || !direction) return { kind: "ask" };
  return {
    kind: "confirm",
    direction,
    directionConfidence: normalizeDetectedPlanConfidence(
      detected.directionConfidence,
    ),
    priceConfidence: normalizeDetectedPlanConfidence(detected.priceConfidence),
    entry: normalizeDetectedPlanPrice(detected.entry),
    stop: normalizeDetectedPlanPrice(detected.stop),
    target: normalizeDetectedPlanPrice(detected.target),
  };
}

function normalizeDetectedPlanConfidence(value) {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "low";
}

function getDetectedPlanLevels(planPrompt) {
  return {
    entry: planPrompt.entry || null,
    stop: planPrompt.stop || null,
    target: planPrompt.target || null,
  };
}

function countDetectedPlanLevels(planPrompt) {
  return ["entry", "stop", "target"].filter((field) => planPrompt[field])
    .length;
}

// The backend already emits plain machine price strings or null - commas and
// junk are stripped there. This is the last gate before a price reaches the
// stated-back line or the confirm button, so anything else becomes null.
function normalizeDetectedPlanPrice(value) {
  const text = normalizePanelText(value);
  return DETECTED_PLAN_PRICE.test(text) ? text : null;
}

function joinDetectedPlanFields(fields) {
  if (fields.length <= 1) return fields[0] || "";
  const head = fields.slice(0, -1).join(", ");
  return fields.length > 2
    ? `${head}, or ${fields[fields.length - 1]}`
    : `${head} or ${fields[fields.length - 1]}`;
}

/**
 * Phrased from what the vision pass could actually read, and only as firmly
 * as it deserves. A level it could not read is named as a question instead of
 * printed as a hole, and anything short of `priceConfidence: "high"` is
 * hedged - the backend only reports "high" for a complete, parseable triplet,
 * so an assertive line always has all three levels behind it. Presenting an
 * axis-inferred price as fact is how a mentor loses the user on the one turn
 * that has to earn their trust.
 */
function buildDetectedPlanLine(planPrompt) {
  if (planPrompt.kind !== "confirm") {
    return "I can't see a position box on this chart. Tell me your direction, entry, stop, and target and I'll pull it apart.";
  }
  const missing = ["entry", "stop", "target"].filter(
    (field) => !planPrompt[field],
  );
  const directionHedged = planPrompt.directionConfidence === "low";
  if (missing.length === 3) {
    // Nothing numeric to soften, so only the direction read can hedge here.
    const opener = directionHedged
      ? `Looks like a ${planPrompt.direction} position`
      : `I can see a ${planPrompt.direction} position`;
    return `${opener} but I can't read the levels off the axis - what are your entry, stop, and target?`;
  }

  const hedged = directionHedged || planPrompt.priceConfidence !== "high";
  const head = hedged
    ? `Looks like a ${planPrompt.direction} ${buildHedgedPlanLevels(planPrompt)}`
    : `I read a ${planPrompt.direction} ${buildAssertedPlanLevels(planPrompt)}`;
  if (!missing.length) {
    return `${head} - ${hedged ? "confirm or fix the numbers?" : "is that your plan?"}`;
  }
  const ask = missing.length > 1 ? "what are they?" : "what is it?";
  return `${head} but I can't read the ${joinDetectedPlanFields(missing)} - ${ask}`;
}

function buildHedgedPlanLevels(planPrompt) {
  const parts = [];
  if (planPrompt.entry) parts.push(`around ${planPrompt.entry}`);
  if (planPrompt.stop) parts.push(`with a stop near ${planPrompt.stop}`);
  if (planPrompt.target) {
    parts.push(
      `${parts.length ? "and" : "with"} a target near ${planPrompt.target}`,
    );
  }
  return parts.join(" ");
}

function buildAssertedPlanLevels(planPrompt) {
  const parts = [];
  if (planPrompt.entry) parts.push(`from ${planPrompt.entry}`);
  if (planPrompt.stop) parts.push(`stop ${planPrompt.stop}`);
  if (planPrompt.target) parts.push(`target ${planPrompt.target}`);
  return parts.join(", ");
}

function appendDetectedPlanActions(actions, planPrompt) {
  if (planPrompt.kind !== "confirm") {
    const logPlan = document.createElement("button");
    logPlan.type = "button";
    logPlan.className = "live-mentor-action primary";
    logPlan.textContent = "Log my plan";
    logPlan.addEventListener("click", () => {
      void trackPanelEvent("detected_plan_manual_fallback", {
        reason: "no_box_detected",
      });
      openManualPlanModal();
    });
    actions.appendChild(logPlan);
    return;
  }

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "live-mentor-action primary";
  confirmButton.textContent = "Yes, review it";
  confirmButton.addEventListener("click", () => {
    confirmButton.disabled = true;
    // Unread levels are omitted, never sent as null: the backend treats a
    // detected plan as trusted on direction alone and reads the rest off the
    // screenshot, while a null would look like a declared-but-empty field.
    const declaredPlan = { source: "detected", direction: planPrompt.direction };
    ["entry", "stop", "target"].forEach((field) => {
      if (planPrompt[field]) declaredPlan[field] = planPrompt[field];
    });
    void trackPanelEvent("detected_plan_confirmed", {
      direction: planPrompt.direction,
      hasEntry: Boolean(planPrompt.entry),
      hasStop: Boolean(planPrompt.stop),
      hasTarget: Boolean(planPrompt.target),
    });
    void startAnalysis(null, { declaredPlan });
  });

  // Correcting a misread must be editing one number, not retyping four
  // fields, so the reject path hands the manual form everything the vision
  // pass did extract. The label follows the actual affordance: there are only
  // "numbers to fix" when at least one level came back.
  const extractedLevels = countDetectedPlanLevels(planPrompt);
  const rejectButton = document.createElement("button");
  rejectButton.type = "button";
  rejectButton.className = "live-mentor-action";
  rejectButton.textContent = extractedLevels ? "Fix the numbers" : "Not my plan";
  rejectButton.addEventListener("click", () => {
    void trackPanelEvent("detected_plan_rejected", {
      direction: planPrompt.direction,
      extractedLevels,
    });
    openManualPlanModal({
      direction: planPrompt.direction,
      ...getDetectedPlanLevels(planPrompt),
    });
  });
  actions.append(confirmButton, rejectButton);
}

function appendMentorTurnActions(
  message,
  { analysisData, signal, watchCondition, symbol, timeframe, planPrompt },
) {
  const actions = document.createElement("div");
  actions.className = "live-mentor-actions";
  // A plan awaiting confirmation is not tradeable yet, so the turn offers no
  // one-click alert alongside it. The "no box" ask carries no proposed plan,
  // so a genuine watch-condition alert still belongs there.
  const alertPlan =
    planPrompt?.kind === "confirm"
      ? null
      : buildTradingViewAlertPlan({
          signal,
          watchCondition,
          symbol,
          timeframe,
        });
  if (alertPlan) {
    const alertButton = document.createElement("button");
    alertButton.type = "button";
    alertButton.className = "live-mentor-action";
    alertButton.textContent = "Set TradingView alert";
    alertButton.addEventListener("click", async () => {
      alertButton.disabled = true;
      alertButton.textContent = "Opening alert…";
      const alertResult = await copyAndOpenTradingViewAlert(alertPlan.level);
      const { copied, opened, filled } = alertResult;
      alertButton.textContent = filled
        ? "Price filled · confirm alert"
        : copied && opened
          ? "Price copied · alert open"
          : opened
            ? "Alert open · copy failed"
            : copied
              ? "Price copied · open failed"
              : "Could not open alert";
      showTradingViewAlertGuidance(actions, alertResult, alertPlan);
      window.setTimeout(() => {
        alertButton.disabled = false;
        alertButton.textContent = "Set TradingView alert";
      }, 2400);
      trackPanelEvent("scan_result_alert_opened", {
        symbol,
        timeframe,
        level: alertPlan.level,
        operator: alertPlan.operator,
        copied,
        opened,
        filled,
      });
    });
    actions.appendChild(alertButton);
  }
  if (planPrompt) appendDetectedPlanActions(actions, planPrompt);
  appendFeedbackControls(actions, analysisData);
  message.appendChild(actions);
}

function renderSetupScanCard(analysisData) {
  clearStaleAnalysisErrors();
  const signals = Array.isArray(analysisData.signals)
    ? analysisData.signals
    : [];
  const renderableSignals = getRenderableSignals(signals);
  const signal = renderableSignals[0] || null;
  const rawWatchCondition =
    analysisData.watchCondition || analysisData.watch_condition || null;
  const watchAlertLevel = getWatchAlertLevel(rawWatchCondition);
  if (rawWatchCondition && !watchAlertLevel) {
    // The backend schema requires watchCondition.alertLevel as a numeric,
    // non-optional field, so this should be unreachable in normal operation.
    // If it fires, a real backend watch got silently dropped from the UI -
    // surface it instead of failing silent.
    console.warn(
      "ChartMentor: Dropping watchCondition with no extractable alert level",
      rawWatchCondition,
    );
  }
  const watchCondition = watchAlertLevel ? rawWatchCondition : null;
  appendMentorChatTurn({ analysisData, signal, watchCondition });
}

function renderChartQualityBlockedCard(analysisData) {
  const blockedReason = normalizePanelText(
    analysisData.chartQualityBlockReason ||
      analysisData.visualPreflight?.blockReason ||
      "The chart is too cluttered for a reliable analysis.",
  );
  appendMentorChatTurn({
    analysisData: {
      ...analysisData,
      analysis: blockedReason,
      chartQualityBlockReason: blockedReason,
    },
    blocked: true,
  });
}
