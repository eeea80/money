/**
 * ChartMentor outcome loop. Prompts are local and account-scoped; the only
 * network request is the user's explicit one-tap outcome submission.
 */

const OUTCOME_PROMPTS_STORAGE_PREFIX = "cm_pending_outcomes_v2";
const OUTCOME_DUE_DELAY_MS = 4 * 60 * 60 * 1000;
const OUTCOME_RETRY_DELAY_MS = 15 * 60 * 1000;
const OUTCOME_CONTEXT_DEFER_MS = 30 * 60 * 1000;
const OUTCOME_MAX_PENDING = 20;
const OUTCOME_PERIODIC_CHECK_MS = 5 * 60 * 1000;

const outcomePromptLocal = {
  shownThisSession: false,
  activeEntry: null,
  activeOwnerSubject: null,
};

function normalizeOutcomeOwnerSubject(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
    ? value
    : null;
}

function getOutcomeStorageKey(ownerSubject) {
  const owner = normalizeOutcomeOwnerSubject(ownerSubject);
  return owner ? `${OUTCOME_PROMPTS_STORAGE_PREFIX}:${owner}` : null;
}

async function getActiveOutcomeOwnerSubject() {
  const token = await ChartMentorStorage.getAuthToken();
  return normalizeOutcomeOwnerSubject(getHistoryOwnerSubjectFromToken(token));
}

async function readPendingOutcomes(ownerSubject) {
  const key = getOutcomeStorageKey(ownerSubject);
  if (!key) return [];
  try {
    const stored = await chrome.storage.local.get([key]);
    return Array.isArray(stored[key]) ? stored[key] : [];
  } catch (error) {
    console.debug("ChartMentor: Failed to read pending outcomes", error);
    return [];
  }
}

async function writePendingOutcomes(ownerSubject, list) {
  const key = getOutcomeStorageKey(ownerSubject);
  if (!key) return false;
  try {
    await chrome.storage.local.set({
      [key]: list.slice(-OUTCOME_MAX_PENDING),
    });
    return true;
  } catch (error) {
    console.debug("ChartMentor: Failed to persist pending outcomes", error);
    return false;
  }
}

function getOutcomeResponseData(response) {
  if (response?.data && typeof response.data === "object") return response.data;
  return response && typeof response === "object" ? response : null;
}

function getOutcomeKind(data, declaredPlan = null) {
  const focus = data?.analysisFocus || data?.analysis_focus;
  if (focus === "position_review") return "position";
  // Recovery may replay an older response which predates the echoed focus.
  // An explicit declared plan is sufficient only when no contradictory focus
  // is present; current response envelopes remain authoritative.
  if (!focus && declaredPlan) return "position";
  if (data?.watchCondition || data?.watch_condition) return "watch";
  if (Array.isArray(data?.signals) && data.signals.length > 0) return "signal";
  return null;
}

async function scheduleOutcomePromptFromResponse(response, options = {}) {
  const data = getOutcomeResponseData(response);
  const declaredPlan = data?.declaredPlan || options.declaredPlan || null;
  const analysisId = data?.analysisId || data?.analysis_id || null;
  const ownerSubject =
    normalizeOutcomeOwnerSubject(options.ownerSubject) ||
    (await getActiveOutcomeOwnerSubject());
  const kind = getOutcomeKind(data, declaredPlan);
  if (!ownerSubject || !declaredPlan || !analysisId || !kind) return false;

  const list = await readPendingOutcomes(ownerSubject);
  if (list.some((entry) => entry.analysisId === analysisId)) return false;
  list.push({
    analysisId: String(analysisId).slice(0, 64),
    symbol: normalizePanelText(data.symbol).slice(0, 40) || null,
    timeframe: normalizePanelText(data.timeframe).slice(0, 20) || null,
    planDirection:
      declaredPlan.direction === "LONG" || declaredPlan.direction === "SHORT"
        ? declaredPlan.direction
        : null,
    kind,
    dueAt: Date.now() + OUTCOME_DUE_DELAY_MS,
    retryCount: 0,
  });
  return writePendingOutcomes(ownerSubject, list);
}

const OUTCOME_PROMPT_CHOICES = [
  { outcome: "win", label: "Win", kinds: "" },
  { outcome: "loss", label: "Loss", kinds: "" },
  { outcome: "breakeven", label: "Breakeven", kinds: "" },
  { outcome: "still_open", label: "Still open", kinds: "position signal" },
  { outcome: "not_triggered", label: "Not triggered", kinds: "watch" },
];

function getOutcomeReflectionQuestion(outcome) {
  if (outcome === "win") return "What worked well?";
  if (outcome === "loss" || outcome === "breakeven")
    return "What do you think went wrong?";
  return null;
}

function showOutcomeReflectionStep(prompt, outcome) {
  const choices = prompt?.querySelector(".plan-first-banner-actions");
  if (!choices) return;

  choices.innerHTML = "";

  const question = document.createElement("p");
  question.className = "outcome-chat-prompt-text";
  question.textContent = getOutcomeReflectionQuestion(outcome);
  choices.appendChild(question);

  const textarea = document.createElement("textarea");
  textarea.className = "outcome-reflection-input";
  textarea.maxLength = 500;
  textarea.placeholder = "Optional - a sentence is enough";
  choices.appendChild(textarea);

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "plan-first-btn primary";
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", () => {
    saveButton.disabled = true;
    skipButton.disabled = true;
    void submitOutcomeChoice(outcome, textarea.value.trim() || null);
  });
  choices.appendChild(saveButton);

  const skipButton = document.createElement("button");
  skipButton.type = "button";
  skipButton.className = "plan-first-btn secondary";
  skipButton.textContent = "Skip";
  skipButton.addEventListener("click", () => {
    saveButton.disabled = true;
    skipButton.disabled = true;
    void submitOutcomeChoice(outcome, null);
  });
  choices.appendChild(skipButton);
}

function renderOutcomePromptTurn(text) {
  if (!elements.chatMessages) return null;
  elements.chatMessages
    .querySelector('[data-live-mentor="outcome"]')
    ?.remove();
  clearReviewPlaceholder();
  setReviewContentMode(true);

  const prompt = document.createElement("div");
  prompt.className = "message assistant outcome-chat-prompt";
  prompt.dataset.liveMentor = "outcome";

  const status = document.createElement("div");
  status.className = "live-mentor-status";
  status.innerHTML =
    '<span class="live-mentor-dot" aria-hidden="true"></span><span>Following up</span>';
  prompt.appendChild(status);

  const copy = document.createElement("p");
  copy.id = "outcome-prompt-text";
  copy.className = "outcome-chat-prompt-text";
  copy.textContent = text;
  prompt.appendChild(copy);

  const choices = document.createElement("div");
  choices.className = "plan-first-banner-actions";
  OUTCOME_PROMPT_CHOICES.forEach((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "plan-first-btn outcome-choice";
    button.textContent = choice.label;
    button.dataset.outcome = choice.outcome;
    if (choice.kinds) button.dataset.outcomeKind = choice.kinds;
    button.addEventListener("click", () => {
      if (getOutcomeReflectionQuestion(choice.outcome)) {
        showOutcomeReflectionStep(prompt, choice.outcome);
      } else {
        void submitOutcomeChoice(choice.outcome);
      }
    });
    choices.appendChild(button);
  });

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "plan-first-btn secondary";
  dismiss.textContent = "Skip";
  dismiss.addEventListener("click", () => {
    void skipActiveOutcome();
  });
  choices.appendChild(dismiss);

  prompt.appendChild(choices);
  elements.chatMessages.appendChild(prompt);
  scrollReviewToEnd();
  return prompt;
}

function hideOutcomePromptBanner() {
  elements.chatMessages
    ?.querySelector('[data-live-mentor="outcome"]')
    ?.remove();
  outcomePromptLocal.activeEntry = null;
  outcomePromptLocal.activeOwnerSubject = null;
}

async function updateOutcomeEntry(ownerSubject, analysisId, update) {
  const list = await readPendingOutcomes(ownerSubject);
  const next = list.map((entry) =>
    entry.analysisId === analysisId ? { ...entry, ...update } : entry,
  );
  return writePendingOutcomes(ownerSubject, next);
}

async function removeOutcomeEntry(ownerSubject, analysisId) {
  const list = await readPendingOutcomes(ownerSubject);
  return writePendingOutcomes(
    ownerSubject,
    list.filter((entry) => entry.analysisId !== analysisId),
  );
}

function setOutcomeChoiceVisibility(prompt, kind) {
  prompt?.querySelectorAll("[data-outcome-kind]").forEach((button) => {
    const allowedKinds = String(button.dataset.outcomeKind || "").split(" ");
    button.hidden = !allowedKinds.includes(kind);
  });
}

async function checkForDueOutcomePrompt() {
  if (outcomePromptLocal.shownThisSession || state.panelSurfaceVisible !== true)
    return;
  if (!elements.chatMessages || state.isAnalyzing) return;
  const detectedPlanPrompt = elements.chatMessages?.querySelector(
    '[data-live-mentor="detected-plan"]',
  );
  if (
    detectedPlanPrompt ||
    !elements.manualPlanModal?.classList.contains("hidden")
  )
    return;

  const ownerSubject = await getActiveOutcomeOwnerSubject();
  if (!ownerSubject) return;
  const list = await readPendingOutcomes(ownerSubject);
  const due = list.find(
    (entry) => Number.isFinite(Number(entry.dueAt)) && entry.dueAt <= Date.now(),
  );
  if (!due) return;

  outcomePromptLocal.shownThisSession = true;
  outcomePromptLocal.activeEntry = due;
  outcomePromptLocal.activeOwnerSubject = ownerSubject;

  const chartLabel = [due.symbol, due.timeframe].filter(Boolean).join(" ");
  const subject = chartLabel || "that trade";
  const prompt = renderOutcomePromptTurn(
    due.kind === "watch"
      ? `Did the ${subject} plan trigger?`
      : `How did ${subject} finish?`,
  );
  setOutcomeChoiceVisibility(prompt, due.kind);
  void trackPanelEvent("outcome_prompt_shown", {
    analysisId: due.analysisId,
    kind: due.kind,
  });
}

async function deferActiveOutcome(delayMs, disposition) {
  const entry = outcomePromptLocal.activeEntry;
  const ownerSubject = outcomePromptLocal.activeOwnerSubject;
  hideOutcomePromptBanner();
  if (!entry || !ownerSubject) return false;
  return updateOutcomeEntry(ownerSubject, entry.analysisId, {
    dueAt: Date.now() + delayMs,
    lastDisposition: disposition,
  });
}

async function submitOutcomeChoice(outcome, notes = null) {
  const entry = outcomePromptLocal.activeEntry;
  const ownerSubject = outcomePromptLocal.activeOwnerSubject;
  if (!entry || !ownerSubject) return false;

  hideOutcomePromptBanner();
  const activeOwnerSubject = await getActiveOutcomeOwnerSubject();
  if (activeOwnerSubject !== ownerSubject) {
    outcomePromptLocal.shownThisSession = false;
    return false;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "submitReviewOutcome",
      data: {
        tradeResult: outcome,
        analysisId: entry.analysisId,
        planDirection: entry.planDirection,
        symbol: entry.symbol,
        timeframe: entry.timeframe,
        notes:
          typeof notes === "string" && notes.trim()
            ? notes.trim().slice(0, 500)
            : null,
        expectedAuthSubject: ownerSubject,
      },
    });
    if (response?.success) {
      if (outcome === "still_open") {
        await updateOutcomeEntry(ownerSubject, entry.analysisId, {
          dueAt: Date.now() + OUTCOME_DUE_DELAY_MS,
          retryCount: 0,
          lastDisposition: "still_open",
          lastError: null,
        });
        return true;
      }
      await removeOutcomeEntry(ownerSubject, entry.analysisId);
      return true;
    }
    await updateOutcomeEntry(ownerSubject, entry.analysisId, {
      dueAt: Date.now() + OUTCOME_RETRY_DELAY_MS,
      retryCount: Number(entry.retryCount || 0) + 1,
      lastError: normalizePanelText(response?.error || "submit_failed").slice(0, 120),
    });
    outcomePromptLocal.shownThisSession = false;
  } catch (error) {
    await updateOutcomeEntry(ownerSubject, entry.analysisId, {
      dueAt: Date.now() + OUTCOME_RETRY_DELAY_MS,
      retryCount: Number(entry.retryCount || 0) + 1,
      lastError: normalizePanelText(error?.message || "network_error").slice(0, 120),
    });
    outcomePromptLocal.shownThisSession = false;
  }
  return false;
}

async function skipActiveOutcome() {
  const entry = outcomePromptLocal.activeEntry;
  const ownerSubject = outcomePromptLocal.activeOwnerSubject;
  hideOutcomePromptBanner();
  if (!entry || !ownerSubject) return false;
  return removeOutcomeEntry(ownerSubject, entry.analysisId);
}

async function handleOutcomePromptChartContextUpdate(_data, meta = {}) {
  if (!meta.changed || !outcomePromptLocal.activeEntry) return;
  await deferActiveOutcome(OUTCOME_CONTEXT_DEFER_MS, "chart_changed");
}

function handleOutcomePanelVisibilityChange(visible) {
  state.panelSurfaceVisible = visible === true;
  if (!state.panelSurfaceVisible) {
    if (outcomePromptLocal.activeEntry) {
      hideOutcomePromptBanner();
      outcomePromptLocal.shownThisSession = false;
    }
    return;
  }
  void checkForDueOutcomePrompt();
}

document.addEventListener("DOMContentLoaded", () => {
  window.setTimeout(() => void checkForDueOutcomePrompt(), 1500);
  window.setInterval(() => void checkForDueOutcomePrompt(), OUTCOME_PERIODIC_CHECK_MS);
});

window.ChartMentorOutcomePrompts = {
  scheduleFromResponse: scheduleOutcomePromptFromResponse,
  handleChartContextUpdate: handleOutcomePromptChartContextUpdate,
  handlePanelVisibilityChange: handleOutcomePanelVisibilityChange,
};
