const CONVERSATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONVERSATION_LOAD_PAGES = 500;
const conversationSyncQueues = new Map();

function getUtf8ByteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function isValidConversationUuid(value) {
  return typeof value === "string" && CONVERSATION_UUID_PATTERN.test(value);
}

function createConversationUuid() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function ensureConversationMessageId(message) {
  const currentId = String(message?.id || "").toLowerCase();
  const id = isValidConversationUuid(currentId)
    ? currentId
    : createConversationUuid();
  if (message && typeof message === "object") message.id = id;
  return id;
}

function cloneConversationStructuredContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const encoded = JSON.stringify(value);
    if (getUtf8ByteLength(encoded) > 20_000) return null;
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

function ensureCurrentConversationId(preferredId = null) {
  const preferred = String(preferredId || "").toLowerCase();
  if (isValidConversationUuid(preferred)) {
    state.currentConversationId = preferred;
  } else if (!isValidConversationUuid(state.currentConversationId)) {
    state.currentConversationId = createConversationUuid();
  }
  return state.currentConversationId;
}

function preserveAndResetActiveConversation() {
  void persistVisibleChatToCurrentHistory();
  void clearLastViewState();
  state.currentHistoryId = null;
  state.currentConversationId = null;
}

function getHistoryItemById(historyId = state.currentHistoryId) {
  if (historyId === null || typeof historyId === "undefined") return null;
  return (
    state.history.find((item) => String(item.id) === String(historyId)) || null
  );
}

function getBackendAnalysisId(historyItem) {
  const value = String(
    historyItem?.analysisId || historyItem?.analysis_id || "",
  ).toLowerCase();
  return isValidConversationUuid(value) ? value : null;
}

function normalizeDurableConversationMessage(message, remoteSynced = true) {
  if (!message || typeof message !== "object") return null;
  if (message.role !== "user" && message.role !== "assistant") return null;
  const content = normalizePanelText(message.content).trim().slice(0, 12_000);
  if (!content) return null;
  return {
    id: ensureConversationMessageId(message),
    role: message.role,
    content,
    rawText: Boolean(message.rawText),
    mentorCards: normalizeMentorCards(message.mentorCards),
    structuredContent: cloneConversationStructuredContent(
      message.structuredContent || message.structured_content,
    ),
    timestamp:
      message.timestamp ||
      message.createdAt ||
      message.created_at ||
      new Date().toISOString(),
    remoteSynced: remoteSynced || message.remoteSynced === true,
  };
}

function mergeDurableConversationMessages(remoteMessages, localMessages) {
  const merged = [];
  const seen = new Set();
  const append = (message, remoteSynced) => {
    const normalized = normalizeDurableConversationMessage(
      message,
      remoteSynced,
    );
    if (!normalized || seen.has(normalized.id)) return;
    seen.add(normalized.id);
    merged.push(normalized);
  };
  (Array.isArray(remoteMessages) ? remoteMessages : []).forEach((message) =>
    append(message, true),
  );
  (Array.isArray(localMessages) ? localMessages : []).forEach((message) =>
    append(message, message?.remoteSynced === true),
  );
  return merged;
}

async function loadDurableConversation(conversationId) {
  const normalizedId = String(conversationId || "").toLowerCase();
  if (!isValidConversationUuid(normalizedId)) {
    return { success: false, messages: [], incomplete: true };
  }
  const token = await ChartMentorStorage.getAuthToken();
  const expectedAuthSubject = getHistoryOwnerSubjectFromToken(token);
  if (!expectedAuthSubject) {
    return { success: false, messages: [], incomplete: true };
  }

  const messages = [];
  let afterSequence = 0;
  for (let page = 0; page < MAX_CONVERSATION_LOAD_PAGES; page += 1) {
    const response = await chrome.runtime.sendMessage({
      type: "getMentorConversation",
      data: { conversationId: normalizedId, afterSequence, expectedAuthSubject },
    });
    if (!response?.success) {
      return {
        success: false,
        messages,
        incomplete: true,
        error: response?.error || "Conversation could not be loaded.",
      };
    }
    const pageMessages = Array.isArray(response.data?.messages)
      ? response.data.messages
      : [];
    messages.push(...pageMessages);
    if (!response.data?.hasMore) {
      return { success: true, messages, incomplete: false };
    }
    const nextSequence = Number(response.data?.nextSequence || 0);
    if (!Number.isSafeInteger(nextSequence) || nextSequence <= afterSequence) {
      return { success: false, messages, incomplete: true };
    }
    afterSequence = nextSequence;
  }
  return { success: true, messages, incomplete: true };
}

function markMessagesRemotelySynced(messageIds) {
  const ids = new Set(messageIds);
  state.messages.forEach((message) => {
    if (ids.has(String(message.id))) message.remoteSynced = true;
  });
}

function createConversationMessageBatches(messages) {
  const batches = [];
  let batch = [];
  let batchBytes = 0;
  for (const message of messages) {
    const messageBytes = getUtf8ByteLength(JSON.stringify(message));
    if (batch.length > 0 && (batch.length >= 20 || batchBytes + messageBytes > 55_000)) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(message);
    batchBytes += messageBytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function saveConversationSnapshot({
  conversationId,
  historyId,
  historyItem,
  messages,
  symbol,
  timeframe,
  expectedAuthSubject,
}) {
  const normalizedMessages = (Array.isArray(messages) ? messages : [])
    .map((message) => normalizeDurableConversationMessage(message, false))
    .filter((message) => message && message.remoteSynced !== true);
  if (!normalizedMessages.length || !expectedAuthSubject) return true;

  let effectiveConversationId = conversationId;
  const syncedIds = new Set();
  const batches = createConversationMessageBatches(normalizedMessages);
  for (const batch of batches) {
    const response = await chrome.runtime.sendMessage({
      type: "saveMentorConversationMessages",
      data: {
        conversationId: effectiveConversationId,
        analysisId: getBackendAnalysisId(historyItem),
        symbol: normalizePanelText(symbol).slice(0, 64) || null,
        timeframe: normalizePanelText(timeframe).slice(0, 24) || null,
        messages: batch.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          structuredContent: message.structuredContent,
        })),
        expectedAuthSubject,
      },
    });
    if (!response?.success) return false;
    const returnedId = String(response.data?.conversationId || "").toLowerCase();
    if (isValidConversationUuid(returnedId)) effectiveConversationId = returnedId;
    batch.forEach((message) => syncedIds.add(message.id));
    markMessagesRemotelySynced(batch.map((message) => message.id));
  }

  if (String(state.currentConversationId) === String(conversationId)) {
    state.currentConversationId = effectiveConversationId;
  }
  const currentHistoryItem = getHistoryItemById(historyId);
  if (currentHistoryItem) {
    const isActiveHistory = String(state.currentHistoryId) === String(historyId);
    const cachedMessages = isActiveHistory
      ? getPersistableChatMessages()
      : getPersistableChatMessages(messages).map((message) => ({
          ...message,
          remoteSynced:
            message.remoteSynced === true || syncedIds.has(String(message.id)),
        }));
    currentHistoryItem.conversationId = effectiveConversationId;
    currentHistoryItem.chatMessages = cachedMessages;
    currentHistoryItem.chatMessageCount = cachedMessages.length;
    currentHistoryItem.conversationSyncPending = cachedMessages.some(
      (message) => message.remoteSynced !== true,
    );
    await saveHistory(currentHistoryItem);
  }
  return true;
}

function queueConversationSnapshot(snapshot) {
  const queueKey = snapshot.conversationId;
  const previous = conversationSyncQueues.get(queueKey) || Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(() => saveConversationSnapshot(snapshot));
  conversationSyncQueues.set(queueKey, operation);
  return operation.finally(() => {
    if (conversationSyncQueues.get(queueKey) === operation) {
      conversationSyncQueues.delete(queueKey);
    }
  });
}

async function saveCurrentConversationMessages(
  messages = state.messages,
  context = {},
) {
  const token = await ChartMentorStorage.getAuthToken();
  const expectedAuthSubject = getHistoryOwnerSubjectFromToken(token);
  if (!expectedAuthSubject) return false;
  const historyId = context.historyId ?? state.currentHistoryId;
  const historyItem = context.historyItem || getHistoryItemById(historyId);
  const preferredConversationId = String(
    context.conversationId || historyItem?.conversationId || "",
  ).toLowerCase();
  const isActiveHistory = String(historyId) === String(state.currentHistoryId);
  const conversationId = isValidConversationUuid(preferredConversationId)
    ? preferredConversationId
    : isActiveHistory
      ? ensureCurrentConversationId()
      : createConversationUuid();
  if (isActiveHistory) state.currentConversationId = conversationId;
  return queueConversationSnapshot({
    conversationId,
    historyId,
    historyItem,
    messages: Array.isArray(messages)
      ? messages.map((message) => ({ ...message }))
      : [],
    symbol: context.symbol || historyItem?.symbol || state.currentSymbol,
    timeframe:
      context.timeframe || historyItem?.timeframe || state.currentTimeframe,
    expectedAuthSubject,
  });
}

async function flushConversationOutbox() {
  const pending = state.history
    .filter(
      (item) =>
        isValidConversationUuid(item.conversationId) &&
        Array.isArray(item.chatMessages) &&
        item.chatMessages.some((message) => message.remoteSynced !== true),
    )
    .slice(0, 10);
  for (const item of pending) {
    try {
      await saveCurrentConversationMessages(item.chatMessages, {
        historyId: item.id,
        historyItem: item,
        conversationId: item.conversationId,
        symbol: item.symbol,
        timeframe: item.timeframe,
      });
    } catch (error) {
      console.debug("ChartMentor: Conversation outbox retry failed", error);
    }
  }
}
