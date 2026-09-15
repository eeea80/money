const MENTOR_REVIEW_ITEM_MAX_CHARS = 240;
const MENTOR_REVIEW_TEXT_MAX_CHARS = 600;
const MENTOR_REVIEW_FOLLOWUP_MAX_CHARS = 2200;

function boundedMentorText(value, maxLength = MENTOR_REVIEW_ITEM_MAX_CHARS) {
  return normalizePanelText(value).slice(0, maxLength);
}

// Mirrors the chat renderer's near-match rule (scanTextsMatch) for cross-field
// dedupe, but stays local so this module has no load-order dependency on it.
function mentorTextsMatch(a, b) {
  if (typeof scanTextsMatch === "function") return scanTextsMatch(a, b);
  return a === b;
}

// Dedupes with the same near-match rule the chat renderer uses for its own
// cross-field dedupe, so a repeated observation/conflict never survives
// normalization to be rendered twice as separate bullets.
function boundedMentorList(value, maxItems = 4) {
  if (!Array.isArray(value)) return [];
  const deduped = [];
  value.forEach((item) => {
    const text = boundedMentorText(item);
    if (!text) return;
    if (deduped.some((existing) => mentorTextsMatch(existing, text))) return;
    deduped.push(text);
  });
  return deduped.slice(0, maxItems);
}

function normalizeMentorReview(rawValue) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue))
    return null;
  const memoryReferences = Array.isArray(rawValue.memoryReferences)
    ? rawValue.memoryReferences
        .map((reference) => {
          const source =
            reference?.source === "seeded" || reference?.source === "observed"
              ? reference.source
              : null;
          const label = boundedMentorText(reference?.label, 160);
          return source && label ? { source, label } : null;
        })
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const decisionState = [
    "decision_made",
    "decision_needed",
    "not_applicable",
  ].includes(rawValue.decisionState)
    ? rawValue.decisionState
    : "not_applicable";
  const review = {
    observedFacts: boundedMentorList(rawValue.observedFacts),
    clarifyingQuestions: boundedMentorList(rawValue.clarifyingQuestions, 3),
    planConflicts: boundedMentorList(rawValue.planConflicts, 3),
    thesisAssessment: boundedMentorText(
      rawValue.thesisAssessment,
      MENTOR_REVIEW_TEXT_MAX_CHARS,
    ),
    decisionState,
    mentorMessage: boundedMentorText(
      rawValue.mentorMessage,
      MENTOR_REVIEW_TEXT_MAX_CHARS,
    ),
    nextQuestion: boundedMentorText(rawValue.nextQuestion, 320) || null,
    memoryReferences,
  };
  const hasContent =
    review.observedFacts.length > 0 ||
    review.clarifyingQuestions.length > 0 ||
    review.planConflicts.length > 0 ||
    review.thesisAssessment ||
    review.mentorMessage ||
    review.nextQuestion ||
    review.memoryReferences.length > 0;
  return hasContent ? review : null;
}

function normalizeStoredDeclaredPlan(rawValue) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue))
    return null;
  const source =
    rawValue.source === "detected" || rawValue.source === "manual"
      ? rawValue.source
      : null;
  const direction =
    rawValue.direction === "LONG" || rawValue.direction === "SHORT"
      ? rawValue.direction
      : null;
  if (!source || !direction) return null;
  const plan = { source, direction };
  ["entry", "stop", "target"].forEach((field) => {
    const value = boundedMentorText(rawValue[field], 40);
    if (value) plan[field] = value;
  });
  return plan;
}

function formatMentorReviewForFollowUp(rawValue) {
  const review = normalizeMentorReview(rawValue);
  if (!review) return "";
  const lines = [
    "Previous structured mentor review:",
    ...review.observedFacts.map((fact) => `Observed: ${fact}`),
    ...review.planConflicts.map((conflict) => `Plan conflict: ${conflict}`),
    review.thesisAssessment
      ? `Thesis assessment: ${review.thesisAssessment}`
      : null,
    `Decision state: ${review.decisionState}`,
    ...review.clarifyingQuestions.map((question) => `Open question: ${question}`),
    review.nextQuestion ? `Mentor next question: ${review.nextQuestion}` : null,
    ...review.memoryReferences.map(
      (reference) => `Memory (${reference.source}): ${reference.label}`,
    ),
  ].filter(Boolean);
  return lines.join("\n").slice(0, MENTOR_REVIEW_FOLLOWUP_MAX_CHARS);
}
