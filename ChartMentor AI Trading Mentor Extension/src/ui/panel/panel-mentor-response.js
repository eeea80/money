const MENTOR_LINE_MAX_CHARS = 420;

function sanitizeMentorLine(value) {
  return sanitizeScanResultText(value).slice(0, MENTOR_LINE_MAX_CHARS);
}

function getMentorTurnStatus({ signal, watchCondition, analysisFocus, blocked }) {
  if (blocked) {
    return { label: "NEEDS A CLEANER CHART", tone: "blocked", emoji: "⚠️" };
  }
  if (signal) return { label: "PLAN VALID", tone: "signal", emoji: "✅" };
  if (watchCondition) return { label: "WAIT", tone: "wait", emoji: "🔔" };
  if (analysisFocus === "position_review") {
    return { label: "POSITION REVIEW", tone: "review", emoji: "🧭" };
  }
  if (analysisFocus === "trade_validation") {
    return { label: "PLAN REVIEW", tone: "review", emoji: "🧭" };
  }
  return { label: "WATCHING", tone: "wait", emoji: "👀" };
}

// One dedupe ledger covers every field that a mentor turn can display, so a
// repeated observation never survives as both lead prose and a bullet.
function createMentorTextClaimer() {
  const used = [];
  return (value) => {
    const text = sanitizeMentorLine(value);
    if (!text) return null;
    if (used.some((existing) => mentorTextsMatch(existing, text))) return null;
    used.push(text);
    return text;
  };
}

function appendMentorParagraph(content, className, text) {
  if (!text) return;
  const paragraph = document.createElement("p");
  paragraph.className = className;
  paragraph.innerHTML = formatSafeInline(text);
  content.appendChild(paragraph);
}

function buildMentorSectionTitle(emoji, label) {
  const title = document.createElement("h3");
  title.className = "mentor-section-title";
  const icon = document.createElement("span");
  icon.className = "mentor-section-emoji";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = emoji;
  const text = document.createElement("span");
  text.textContent = label;
  title.append(icon, text);
  return title;
}

function buildMentorTextSection({ emoji, title, text, className }) {
  if (!text) return null;
  const section = document.createElement("section");
  section.className = `mentor-section ${className}`;
  const paragraph = document.createElement("p");
  paragraph.className = "mentor-section-copy";
  paragraph.innerHTML = formatSafeInline(text);
  section.append(buildMentorSectionTitle(emoji, title), paragraph);
  return section;
}

function buildMentorBulletGroup(emoji, titleText, items, className = "") {
  if (!items.length) return null;
  const section = document.createElement("section");
  section.className = ["mentor-section", "mentor-bullet-group", className]
    .filter(Boolean)
    .join(" ");
  const list = document.createElement("ul");
  items.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.innerHTML = formatSafeInline(item);
    list.appendChild(listItem);
  });
  section.append(buildMentorSectionTitle(emoji, titleText), list);
  return section;
}

function getMentorPlanDefinition({ signal, declaredPlan, watchCondition }) {
  if (signal) {
    return {
      emoji: "🎯",
      title: "Active plan",
      fields: [
        ["Direction", signal.direction],
        ["Entry", signal.entry],
        ["Stop", signal.stopLoss],
        ["Target", signal.takeProfit],
      ],
    };
  }
  if (declaredPlan) {
    return {
      emoji: "📋",
      title: "Your plan",
      fields: [
        ["Direction", declaredPlan.direction],
        ["Entry", declaredPlan.entry],
        ["Stop", declaredPlan.stop],
        ["Target", declaredPlan.target],
      ],
    };
  }
  if (watchCondition) {
    return {
      emoji: "🔔",
      title: "Level to watch",
      fields: [
        ["Trigger", watchCondition.trigger],
        ["Cancel if", watchCondition.cancelCondition],
      ],
    };
  }
  return null;
}

function buildMentorPlanSection({ signal, declaredPlan, watchCondition }) {
  const definition = getMentorPlanDefinition({
    signal,
    declaredPlan,
    watchCondition,
  });
  if (!definition) return null;
  const available = definition.fields
    .map(([label, rawValue]) => [label, normalizePanelText(rawValue)])
    .filter(([, value]) => Boolean(value));
  if (!available.length) return null;

  const section = document.createElement("section");
  section.className = "mentor-section mentor-plan-section";
  const table = document.createElement("table");
  table.className = "mentor-plan-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const tbody = document.createElement("tbody");
  const bodyRow = document.createElement("tr");
  available.forEach(([label, value]) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
    const td = document.createElement("td");
    td.textContent = value;
    bodyRow.appendChild(td);
  });
  thead.appendChild(headRow);
  tbody.appendChild(bodyRow);
  table.append(thead, tbody);
  section.append(
    buildMentorSectionTitle(definition.emoji, definition.title),
    table,
  );
  return section;
}

function buildMentorQuestionSection(items) {
  if (!items.length) return null;
  const section = document.createElement("section");
  section.className = "mentor-section mentor-question-section";
  section.appendChild(
    buildMentorSectionTitle(
      "❓",
      items.length === 1 ? "Next question" : "Questions to answer",
    ),
  );
  if (items.length === 1) {
    const paragraph = document.createElement("p");
    paragraph.className = "mentor-question-copy";
    paragraph.innerHTML = formatSafeInline(items[0]);
    section.appendChild(paragraph);
    return section;
  }
  const list = document.createElement("ul");
  items.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.innerHTML = formatSafeInline(item);
    list.appendChild(listItem);
  });
  section.appendChild(list);
  return section;
}

function appendMentorChatTurn({
  analysisData,
  signal = null,
  watchCondition = null,
  blocked = false,
}) {
  const planPrompt = blocked ? null : getDetectedPlanPrompt(analysisData);
  const analysisFocus = getAnalysisFocus(analysisData);
  const symbol = normalizePanelText(
    analysisData.symbol || state.currentSymbol || "Current chart",
  );
  const timeframe = normalizePanelText(
    analysisData.timeframe || state.currentTimeframe || "",
  );
  const status = getMentorTurnStatus({
    signal,
    watchCondition,
    analysisFocus,
    blocked,
  });
  const message = document.createElement("div");
  message.className = `message assistant mentor-live-turn setup-scan-card ${status.tone}`;
  if (blocked) message.classList.add("chart-quality-blocked-card");

  const meta = document.createElement("div");
  meta.className = "live-mentor-status";
  const statusIcon = document.createElement("span");
  statusIcon.className = "live-mentor-status-icon";
  statusIcon.setAttribute("aria-hidden", "true");
  statusIcon.textContent = status.emoji;
  const label = document.createElement("span");
  label.className = "live-mentor-status-label";
  label.textContent = status.label;
  meta.append(statusIcon, label);
  const chartContext = [symbol, timeframe].filter(Boolean).join(" / ");
  if (chartContext) {
    const context = document.createElement("span");
    context.className = "live-mentor-status-context";
    context.textContent = chartContext;
    meta.appendChild(context);
  }
  message.appendChild(meta);

  const content = document.createElement("div");
  content.className = "message-content mentor-live-copy";
  const review = normalizeMentorReview(analysisData?.mentorReview);
  const claim = createMentorTextClaimer();

  let leadText;
  if (planPrompt) {
    leadText = claim(buildDetectedPlanLine(planPrompt));
  } else if (blocked) {
    leadText = claim(
      analysisData.chartQualityBlockReason ||
        analysisData.visualPreflight?.blockReason ||
        analysisData.analysis,
    );
  } else {
    leadText =
      claim(review?.mentorMessage) ||
      claim(analysisData.setupGuidance || analysisData.setup_guidance) ||
      claim(
        analysisData.mentorSummary ||
          analysisData.mentor_summary ||
          analysisData.analysis,
      );
  }
  appendMentorParagraph(content, "mentor-lead", leadText);

  if (review) {
    const observedItems = review.observedFacts.map(claim).filter(Boolean);
    const observedGroup = buildMentorBulletGroup(
      "🔎",
      "What I see",
      observedItems,
      "mentor-observed-section",
    );
    if (observedGroup) content.appendChild(observedGroup);
  }

  const thesisText = blocked
    ? claim(review?.mentorMessage) ||
      claim(
        "Keep the symbol, timeframe, candles, and price scale visible, then ask me again.",
      )
    : claim(review?.thesisAssessment);
  const needsStructuredThesis = Boolean(
    blocked ||
      review?.planConflicts.length ||
      review?.clarifyingQuestions.length ||
      review?.memoryReferences.length,
  );
  if (needsStructuredThesis) {
    const thesisSection = buildMentorTextSection({
      emoji: blocked ? "🛠️" : "🧠",
      title: blocked ? "Make the chart readable" : "Thesis",
      text: thesisText,
      className: "mentor-thesis-section",
    });
    if (thesisSection) content.appendChild(thesisSection);
  } else {
    appendMentorParagraph(content, "mentor-thesis-inline", thesisText);
  }

  if (review) {
    const conflictItems = review.planConflicts.map(claim).filter(Boolean);
    const conflictGroup = buildMentorBulletGroup(
      "⚠️",
      "Conflicts with your plan",
      conflictItems,
      "mentor-conflict-section",
    );
    if (conflictGroup) content.appendChild(conflictGroup);
  }

  if (!blocked) {
    const declaredPlan = normalizeStoredDeclaredPlan(analysisData?.declaredPlan);
    const planSection = buildMentorPlanSection({
      signal,
      declaredPlan,
      watchCondition,
    });
    if (planSection) content.appendChild(planSection);
  }

  if (review) {
    const memoryItems = review.memoryReferences
      .map((reference) => claim(reference.label))
      .filter(Boolean);
    const memoryGroup = buildMentorBulletGroup(
      "📌",
      "From your playbook",
      memoryItems,
      "mentor-memory-section",
    );
    if (memoryGroup) content.appendChild(memoryGroup);

    const questionItems = [...review.clarifyingQuestions, review.nextQuestion]
      .map(claim)
      .filter(Boolean);
    const questionSection = buildMentorQuestionSection(questionItems);
    if (questionSection) content.appendChild(questionSection);
  }

  message.appendChild(content);
  if (!blocked) {
    appendMentorTurnActions(message, {
      analysisData,
      signal,
      watchCondition,
      symbol,
      timeframe,
      planPrompt,
    });
  }

  clearReviewPlaceholder();
  setReviewContentMode(true);
  prepareAssistantResponseReveal(message);
  elements.chatMessages.appendChild(message);
  revealAssistantResult(message, { resetToTop: true });
  return message;
}
