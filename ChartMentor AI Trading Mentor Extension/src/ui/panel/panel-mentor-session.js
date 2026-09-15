const mentorSessionLocal = {
  opening: null,
  lastFailedReply: null,
};

function getMentorSessionChartHint() {
  const confidence = ["high", "medium", "low"].includes(state.symbolConfidence)
    ? state.symbolConfidence
    : "none";
  return {
    symbol: normalizePanelText(state.currentSymbol) || null,
    timeframe: normalizePanelText(state.currentTimeframe) || null,
    symbolConfidence: confidence,
  };
}

function getMentorSessionTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function removeMentorSessionThinking({ animate = false } = {}) {
  dismissChartMentorThinking("chartmentor-mentor-thinking", { animate });
}

function showMentorSessionThinking(label = "Thinking with your context") {
  removeMentorSessionThinking();
  clearReviewPlaceholder();
  setReviewContentMode(true);
  showChartMentorThinking({
    id: "chartmentor-mentor-thinking",
    label,
    parent: elements.chatMessages,
    className: "mentor-session-thinking",
  });
  scrollReviewToEnd();
}

function clearMentorSessionStatus() {
  document.getElementById("mentor-session-status")?.remove();
}

function showMentorSessionStatus(message, { retry = false } = {}) {
  clearMentorSessionStatus();
  removeMentorSessionThinking();
  clearReviewPlaceholder();
  setReviewContentMode(true);
  const status = document.createElement("div");
  status.id = "mentor-session-status";
  status.className = "mentor-session-status";
  status.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = message;
  status.appendChild(text);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Retry";
    button.addEventListener("click", () => {
      clearMentorSessionStatus();
      if (mentorSessionLocal.lastFailedReply) {
        void replyMentorSession(mentorSessionLocal.lastFailedReply.text, {
          ...mentorSessionLocal.lastFailedReply,
          renderUser: false,
        });
      } else {
        void openMentorSession();
      }
    });
    status.appendChild(button);
  }
  elements.chatMessages?.appendChild(status);
  scrollReviewToEnd();
}

function normalizeMentorSessionAssistant(response) {
  const message = response?.data?.assistantMessage;
  const conversationId = String(response?.data?.conversationId || "").toLowerCase();
  if (
    !response?.success ||
    !isValidConversationUuid(conversationId) ||
    !isValidConversationUuid(message?.id) ||
    message?.role !== "assistant" ||
    typeof message?.content !== "string" ||
    !message.content.trim()
  ) {
    return null;
  }
  return {
    conversationId,
    message: {
      id: message.id,
      role: "assistant",
      content: message.content.trim(),
      structuredContent: cloneConversationStructuredContent(message.structuredContent),
      remoteSynced: true,
      responseReady: true,
      isMentorSession: true,
    },
  };
}

async function getMentorSessionAuthSubject() {
  const token = await ChartMentorStorage.getAuthToken();
  return getHistoryOwnerSubjectFromToken(token);
}

function renderMentorSessionMessage(message) {
  const element = addMessage(message.role, message.content, message);
  if (element) element.dataset.mentorSession = "true";
  return element;
}

async function restoreMentorSessionConversation(conversationId) {
  const loaded = await loadDurableConversation(conversationId);
  if (!loaded.success || !Array.isArray(loaded.messages) || loaded.messages.length === 0) {
    return false;
  }
  state.messages = [];
  elements.chatMessages?.replaceChildren();
  restorePersistedChatMessages(loaded.messages, { full: true });
  elements.chatMessages
    ?.querySelectorAll(".message.assistant")
    .forEach((element) => {
      if (element.querySelector(".message-content")) element.dataset.mentorSession = "true";
    });
  return true;
}

async function openMentorSession({ forceNew = false } = {}) {
  if (
    !state.isAuthenticated ||
    mentorSessionLocal.opening ||
    state.isAnalyzing ||
    state.isConversationLoading ||
    (!forceNew && (state.messages.length > 0 || state.currentAnalysis))
  ) {
    return mentorSessionLocal.opening || false;
  }

  mentorSessionLocal.opening = (async () => {
    if (!(await ensureAuthenticated())) return false;
    clearMentorSessionStatus();
    showMentorSessionThinking(forceNew ? "Starting a fresh session" : "Connecting to your mentor");
    state.isMentorSessionLoading = true;
    const expectedAuthSubject = await getMentorSessionAuthSubject();
    if (!expectedAuthSubject) {
      showMentorSessionStatus("Log in again to start your mentor session.");
      return false;
    }
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "mentorSession",
        data: {
          action: "open",
          turnId: createConversationUuid(),
          timezone: getMentorSessionTimezone(),
          chartHint: getMentorSessionChartHint(),
          forceNew,
          expectedAuthSubject,
        },
      });
    } catch (error) {
      console.debug("ChartMentor: Mentor session connection failed", error);
      showMentorSessionStatus("Your mentor could not connect yet.", {
        retry: true,
      });
      return false;
    }
    removeMentorSessionThinking({ animate: true });
    const normalized = normalizeMentorSessionAssistant(response);
    if (!normalized) {
      mentorSessionLocal.lastFailedReply = null;
      const expired = ["session_expired", "invalid_token", "authentication_required"].includes(response?.code);
      showMentorSessionStatus(
        expired ? "Your session expired. Log in again to continue." : "Your mentor could not connect yet.",
        { retry: !expired && response?.code !== "mentor_session_disabled" },
      );
      return false;
    }
    state.currentConversationId = normalized.conversationId;
    const restored = await restoreMentorSessionConversation(normalized.conversationId);
    if (!restored) renderMentorSessionMessage(normalized.message);
    await markExtensionOnboardingComplete();
    trackPanelEvent("mentor_session_visible", {
      source: "extension_panel",
      returningConversation: restored,
    });
    return true;
  })();
  try {
    return await mentorSessionLocal.opening;
  } finally {
    removeMentorSessionThinking({ animate: true });
    mentorSessionLocal.opening = null;
    state.isMentorSessionLoading = false;
    updateReviewModeUI();
  }
}

async function replyMentorSession(text, options = {}) {
  const content = normalizePanelText(text).slice(0, 2_000);
  if (!content || state.isMentorSessionLoading || state.isAnalyzing) return false;
  if (!isValidConversationUuid(state.currentConversationId)) {
    const opened = await openMentorSession();
    if (!opened || !isValidConversationUuid(state.currentConversationId)) return false;
  }
  const expectedAuthSubject = await getMentorSessionAuthSubject();
  if (!expectedAuthSubject) {
    showMentorSessionStatus("Your session expired. Log in again to continue.");
    return false;
  }
  const messageId = options.messageId || createConversationUuid();
  const turnId = options.turnId || createConversationUuid();
  if (options.renderUser !== false) {
    renderMentorSessionMessage({
      id: messageId,
      role: "user",
      content,
      remoteSynced: true,
      isMentorSession: true,
    });
  }
  mentorSessionLocal.lastFailedReply = { text: content, messageId, turnId };
  state.isMentorSessionLoading = true;
  showMentorSessionThinking("Thinking with your context");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "mentorSession",
      data: {
        action: "reply",
        turnId,
        messageId,
        conversationId: state.currentConversationId,
        text: content,
        timezone: getMentorSessionTimezone(),
        chartHint: getMentorSessionChartHint(),
        expectedAuthSubject,
      },
    });
    removeMentorSessionThinking({ animate: true });
    const normalized = normalizeMentorSessionAssistant(response);
    if (!normalized) {
      const expired = ["session_expired", "invalid_token", "authentication_required"].includes(response?.code);
      showMentorSessionStatus(
        expired ? "Your session expired. Log in again to continue." : "That reply did not come through.",
        { retry: !expired },
      );
      return false;
    }
    state.currentConversationId = normalized.conversationId;
    renderMentorSessionMessage(normalized.message);
    mentorSessionLocal.lastFailedReply = null;
    return true;
  } catch (error) {
    console.debug("ChartMentor: Mentor reply failed", error);
    showMentorSessionStatus("That reply did not come through.", {
      retry: true,
    });
    return false;
  } finally {
    removeMentorSessionThinking({ animate: true });
    state.isMentorSessionLoading = false;
  }
}

async function nudgeMentorSession() {
  if (
    !state.isAuthenticated ||
    state.isMentorSessionLoading ||
    state.isAnalyzing ||
    !isValidConversationUuid(state.currentConversationId)
  ) {
    return false;
  }
  const expectedAuthSubject = await getMentorSessionAuthSubject();
  if (!expectedAuthSubject) return false;
  state.isMentorSessionLoading = true;
  showMentorSessionThinking("Reading today's context");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "mentorSession",
      data: {
        action: "nudge",
        turnId: createConversationUuid(),
        conversationId: state.currentConversationId,
        timezone: getMentorSessionTimezone(),
        chartHint: getMentorSessionChartHint(),
        expectedAuthSubject,
      },
    });
    removeMentorSessionThinking({ animate: true });
    const normalized = normalizeMentorSessionAssistant(response);
    if (!normalized) return false;
    state.currentConversationId = normalized.conversationId;
    renderMentorSessionMessage(normalized.message);
    return true;
  } catch (error) {
    console.debug("ChartMentor: Mentor initiative skipped", error);
    return false;
  } finally {
    removeMentorSessionThinking({ animate: true });
    state.isMentorSessionLoading = false;
    updateReviewModeUI();
  }
}

function shouldPreserveMentorSessionOnChartChange() {
  return Boolean(
    isValidConversationUuid(state.currentConversationId) &&
      !state.currentAnalysis &&
      state.messages.some((message) => message?.isMentorSession || message?.structuredContent?.kind === "mentor_session"),
  );
}

window.ChartMentorSession = {
  openIfNeeded: () => openMentorSession(),
  startFresh: () => openMentorSession({ forceNew: true }),
  reply: replyMentorSession,
  nudge: nudgeMentorSession,
  shouldPreserveOnChartChange: shouldPreserveMentorSessionOnChartChange,
};
