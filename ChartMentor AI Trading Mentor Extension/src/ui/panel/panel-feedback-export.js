const PRODUCT_FEEDBACK_MAX_DETAILS = 500;

function getPanelFeedbackContext(analysisData) {
  if (typeof getPromptAnalyticsContext === "function") {
    return getPromptAnalyticsContext(analysisData);
  }
  return {
    responseType: analysisData?.responseType || null,
    reviewMode: analysisData?.reviewMode || null,
    verdict: analysisData?.verdict || null,
    tradeIdeaStatus: analysisData?.tradeIdeaStatus || null,
    signalCount: Array.isArray(analysisData?.signals)
      ? analysisData.signals.length
      : 0,
    hasWatchCondition: Boolean(
      analysisData?.watchCondition || analysisData?.watch_condition,
    ),
  };
}

function appendFeedbackStatus(container, className, text) {
  container
    .querySelectorAll(".feedback-thanks, .feedback-error")
    .forEach((node) => node.remove());
  const status = document.createElement("span");
  status.className = className;
  status.setAttribute(
    "role",
    className === "feedback-error" ? "alert" : "status",
  );
  status.textContent = text;
  container.appendChild(status);
  return status;
}

function setFeedbackButtonsState(buttons, selectedButton, disabled) {
  buttons.forEach((button) => {
    button.disabled = disabled;
    button.classList.toggle("selected", button === selectedButton);
    button.setAttribute(
      "aria-pressed",
      button === selectedButton ? "true" : "false",
    );
  });
}

function appendNegativeFeedbackForm(container, analysisData) {
  const form = document.createElement("div");
  form.className = "feedback-followup";

  const label = document.createElement("label");
  label.className = "feedback-followup-label";
  label.textContent = "What could be better? (optional)";
  form.appendChild(label);

  const details = document.createElement("textarea");
  details.className = "feedback-details";
  details.maxLength = PRODUCT_FEEDBACK_MAX_DETAILS;
  details.rows = 2;
  details.placeholder = "Tell me what felt wrong, unclear, or missing";
  label.htmlFor = `feedback-details-${String(
    analysisData?.analysisId || analysisData?.id || Date.now(),
  ).replace(/[^A-Za-z0-9_-]/g, "")}`;
  details.id = label.htmlFor;
  form.appendChild(details);

  const actions = document.createElement("div");
  actions.className = "feedback-followup-actions";
  const submitButton = document.createElement("button");
  submitButton.type = "button";
  submitButton.className = "feedback-submit-btn";
  submitButton.textContent = "Send feedback";
  const skipButton = document.createElement("button");
  skipButton.type = "button";
  skipButton.className = "feedback-skip-btn";
  skipButton.textContent = "No comment";
  actions.appendChild(submitButton);
  actions.appendChild(skipButton);
  form.appendChild(actions);

  let submitting = false;
  const saveNegativeFeedback = async (includeComment) => {
    if (submitting) return;
    submitting = true;
    submitButton.disabled = true;
    skipButton.disabled = true;
    details.disabled = true;
    form.querySelectorAll(".feedback-error").forEach((node) => node.remove());

    const saved = await submitProductFeedbackFromPanel({
      source: "scan_rating_followup",
      promptId: "scan-rating-followup-v1",
      rating: "not_helpful",
      reason: "thumbs_down",
      details: includeComment
        ? details.value.slice(0, PRODUCT_FEEDBACK_MAX_DETAILS)
        : "",
      analysisId: String(
        analysisData?.analysisId || analysisData?.id || "",
      ).slice(0, 160),
      context: getPanelFeedbackContext(analysisData),
    });
    if (saved) {
      form.remove();
      appendFeedbackStatus(container, "feedback-thanks", "Thanks, noted");
      return;
    }

    submitting = false;
    submitButton.disabled = false;
    skipButton.disabled = false;
    details.disabled = false;
    appendFeedbackStatus(form, "feedback-error", "Couldn't save. Try again.");
  };

  submitButton.addEventListener("click", () => {
    void saveNegativeFeedback(true);
  });
  skipButton.addEventListener("click", () => {
    void saveNegativeFeedback(false);
  });
  container.appendChild(form);
  window.requestAnimationFrame?.(() => details.focus());
}

function appendFeedbackControls(container, analysisData) {
  const label = document.createElement("span");
  label.className = "feedback-label";
  label.textContent = "Was this helpful?";
  container.appendChild(label);

  const buttons = [];
  [
    { icon: "👍", label: "Helpful", rating: "useful", reason: "thumbs_up" },
    {
      icon: "👎",
      label: "Not helpful",
      rating: "not_helpful",
      reason: "thumbs_down",
    },
  ].forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "feedback-btn";
    button.dataset.feedbackTone = option.rating;
    button.textContent = option.icon;
    button.title = option.label;
    button.setAttribute("aria-label", option.label);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      container.querySelector(".feedback-followup")?.remove();
      container
        .querySelectorAll(".feedback-thanks, .feedback-error")
        .forEach((node) => node.remove());
      setFeedbackButtonsState(buttons, button, true);

      if (option.rating === "not_helpful") {
        void submitFeedback(analysisData, option.rating, { durable: false });
        appendNegativeFeedbackForm(container, analysisData);
        return;
      }

      const saved = await submitFeedback(analysisData, option.rating, {
        reason: option.reason,
        context: getPanelFeedbackContext(analysisData),
      });
      if (saved) {
        appendFeedbackStatus(container, "feedback-thanks", "Thanks, noted");
        return;
      }

      setFeedbackButtonsState(buttons, null, false);
      appendFeedbackStatus(
        container,
        "feedback-error",
        "Couldn't save. Try again.",
      );
    });
    buttons.push(button);
    container.appendChild(button);
  });
}

window.ChartMentorPanel = {
  switchTab,
  reviewPlan: (...args) => window.ChartMentorPlanFirst?.requestReview(...args),
  addMessage,
  updateUsage: updateUsageDisplay,
};
