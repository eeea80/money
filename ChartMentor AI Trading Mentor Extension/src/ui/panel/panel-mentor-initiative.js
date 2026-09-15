const MENTOR_INITIATIVE_DAILY_CAP = 3;
const MENTOR_INITIATIVE_COOLDOWN_MS = 15 * 60 * 1000;
const MENTOR_INITIATIVE_STABLE_MS = 1800;
const mentorInitiativeLocal = {
  timerId: null,
  pendingFingerprint: null,
  latestContext: null,
};

function isMentorInitiativeEntitled() {
  return ["pro", "elite"].includes(getUserTier(state.user));
}

function isReliableMentorInitiativeContext(data) {
  const symbol = normalizePanelText(data?.symbol);
  const timeframe = normalizePanelText(data?.timeframe);
  return Boolean(
    symbol &&
      timeframe &&
      !isPlaceholderSymbol(symbol) &&
      ["high", "medium"].includes(data?.symbolConfidence),
  );
}

function getMentorInitiativeFingerprint(data) {
  return [
    normalizePanelText(data?.symbol).toUpperCase(),
    normalizePanelText(data?.timeframe),
  ].join("|");
}

function hasEngagedMentorConversation() {
  return Boolean(
    isValidConversationUuid(state.currentConversationId) &&
      state.messages.some(
        (message) => message?.role === "user",
      ) &&
      state.messages.some(
        (message) => message?.role === "assistant" && message?.isMentorSession,
      ),
  );
}

async function getMentorInitiativeUsage() {
  const storageKey = await getScopedPanelStorageKey("mentorInitiative");
  if (!storageKey) return { storageKey: null, value: null };
  const stored = await chrome.storage.local.get([storageKey]);
  const today = new Date().toLocaleDateString("en-CA");
  const current = stored[storageKey];
  if (!current || current.date !== today) {
    return {
      storageKey,
      value: { date: today, count: 0, lastAttemptAt: 0, fingerprints: [] },
    };
  }
  return {
    storageKey,
    value: {
      date: today,
      count: Math.max(0, Number(current.count) || 0),
      lastAttemptAt: Math.max(0, Number(current.lastAttemptAt) || 0),
      fingerprints: Array.isArray(current.fingerprints)
        ? current.fingerprints
            .filter((item) => typeof item === "string")
            .slice(-20)
        : [],
    },
  };
}

async function reserveMentorInitiativeUnlocked(fingerprint) {
  const usage = await getMentorInitiativeUsage();
  if (!usage.storageKey || !usage.value) return false;
  const now = Date.now();
  if (
    usage.value.count >= MENTOR_INITIATIVE_DAILY_CAP ||
    now - usage.value.lastAttemptAt < MENTOR_INITIATIVE_COOLDOWN_MS ||
    usage.value.fingerprints.includes(fingerprint)
  ) {
    return false;
  }
  await chrome.storage.local.set({
    [usage.storageKey]: {
      ...usage.value,
      count: usage.value.count + 1,
      lastAttemptAt: now,
      fingerprints: [...usage.value.fingerprints, fingerprint].slice(-20),
    },
  });
  return true;
}

async function reserveMentorInitiative(fingerprint) {
  const token = await ChartMentorStorage.getAuthToken();
  const subject = getHistoryOwnerSubjectFromToken(token);
  if (!subject) return false;
  if (!navigator.locks?.request) {
    return reserveMentorInitiativeUnlocked(fingerprint);
  }
  return navigator.locks.request(
    `chartmentor-mentor-initiative:${subject}`,
    () => reserveMentorInitiativeUnlocked(fingerprint),
  );
}

function clearMentorInitiativeTimer() {
  if (mentorInitiativeLocal.timerId) {
    window.clearTimeout(mentorInitiativeLocal.timerId);
  }
  mentorInitiativeLocal.timerId = null;
  mentorInitiativeLocal.pendingFingerprint = null;
}

function canScheduleMentorInitiative(data) {
  return Boolean(
    state.bootstrapReady &&
      state.panelSurfaceVisible === true &&
      state.isAuthenticated &&
      isMentorInitiativeEntitled() &&
      !state.isAnalyzing &&
      !state.isClearingSession &&
      !state.isMentorSessionLoading &&
      !state.isConversationLoading &&
      !state.currentAnalysis &&
      hasEngagedMentorConversation() &&
      isReliableMentorInitiativeContext(data),
  );
}

async function triggerMentorInitiative(expectedFingerprint) {
  mentorInitiativeLocal.timerId = null;
  mentorInitiativeLocal.pendingFingerprint = null;
  if (!canScheduleMentorInitiative(mentorInitiativeLocal.latestContext)) return;
  const latestContext = await getChartInfo().catch(() => null);
  if (
    !canScheduleMentorInitiative(latestContext) ||
    getMentorInitiativeFingerprint(latestContext) !== expectedFingerprint ||
    !(await reserveMentorInitiative(expectedFingerprint))
  ) {
    return;
  }
  void trackPanelEvent("mentor_initiative_started", {
    source: "stable_chart",
    symbol: normalizePanelText(latestContext.symbol),
    timeframe: normalizePanelText(latestContext.timeframe),
  });
  await window.ChartMentorSession?.nudge?.();
}

function scheduleMentorInitiative(data) {
  mentorInitiativeLocal.latestContext = data || null;
  if (!canScheduleMentorInitiative(data)) {
    clearMentorInitiativeTimer();
    return;
  }
  const fingerprint = getMentorInitiativeFingerprint(data);
  if (mentorInitiativeLocal.pendingFingerprint === fingerprint) return;
  clearMentorInitiativeTimer();
  mentorInitiativeLocal.pendingFingerprint = fingerprint;
  mentorInitiativeLocal.timerId = window.setTimeout(
    () => void triggerMentorInitiative(fingerprint),
    MENTOR_INITIATIVE_STABLE_MS,
  );
}

function handleMentorInitiativeContext(data, { changed = false } = {}) {
  mentorInitiativeLocal.latestContext = data || null;
  if (!changed) return;
  scheduleMentorInitiative(data);
}

function handleMentorInitiativeVisibility(visible) {
  if (!visible) {
    clearMentorInitiativeTimer();
    return;
  }
  if (mentorInitiativeLocal.latestContext) {
    scheduleMentorInitiative(mentorInitiativeLocal.latestContext);
  }
}

function handleMentorInitiativeProfile() {
  if (!isMentorInitiativeEntitled()) {
    clearMentorInitiativeTimer();
    return;
  }
  if (state.panelSurfaceVisible) {
    void getChartInfo().then(scheduleMentorInitiative).catch(() => {});
  }
}

window.ChartMentorInitiative = {
  handleChartContextUpdate: handleMentorInitiativeContext,
  handlePanelVisibilityChange: handleMentorInitiativeVisibility,
  handleProfileUpdate: handleMentorInitiativeProfile,
};
