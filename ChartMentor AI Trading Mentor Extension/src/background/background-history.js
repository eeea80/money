const LOCAL_ANALYSIS_HISTORY_PREFIX = "analysisHistory";
const LOCAL_ANALYSIS_HISTORY_MAX_ITEMS = 50;
const localHistoryWriteQueues = new Map();

function getLocalHistoryItemIdentity(item) {
  if (!item || typeof item !== "object") return null;
  const value = item.analysisId || item.requestId || item.id;
  return value === undefined || value === null ? null : String(value);
}

function getLocalHistoryTimestamp(item) {
  const timestamp = Date.parse(item?.timestamp || item?.updatedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeLocalHistoryItem(existing, incoming) {
  const next = { ...existing, ...incoming };
  if (
    Array.isArray(existing?.chatMessages) &&
    existing.chatMessages.length > 0 &&
    (!Array.isArray(incoming?.chatMessages) ||
      incoming.chatMessages.length === 0)
  ) {
    next.chatMessages = existing.chatMessages;
    next.chatMessageCount = existing.chatMessages.length;
  }
  return next;
}

async function getActiveLocalHistorySubject() {
  const authState = await chrome.storage.local.get([STORAGE_KEYS.AUTH_TOKEN]);
  return decodeJwtSubject(
    authState[STORAGE_KEYS.AUTH_TOKEN] || sessionData?.access_token || null,
  );
}

async function upsertLocalHistoryItem(expectedAuthSubject, rawItem) {
  const activeSubject = await getActiveLocalHistorySubject();
  if (!activeSubject || activeSubject !== expectedAuthSubject) {
    return {
      success: false,
      error: "The active account changed before local history could be saved.",
      code: "account_changed",
    };
  }

  const identity = getLocalHistoryItemIdentity(rawItem);
  if (!identity || !rawItem || typeof rawItem !== "object") {
    return {
      success: false,
      error: "Invalid local history item.",
      code: "invalid_history_item",
    };
  }

  const storageKey = `${LOCAL_ANALYSIS_HISTORY_PREFIX}:${activeSubject}`;
  const previous = localHistoryWriteQueues.get(storageKey) || Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const stored = await chrome.storage.local.get([storageKey]);
      const current = Array.isArray(stored[storageKey])
        ? stored[storageKey]
        : [];
      const incoming = { ...rawItem, id: String(rawItem.id || identity) };
      const existingIndex = current.findIndex(
        (item) => getLocalHistoryItemIdentity(item) === identity,
      );
      const next = [...current];
      if (existingIndex >= 0) {
        next[existingIndex] = mergeLocalHistoryItem(
          next[existingIndex],
          incoming,
        );
      } else {
        next.push(incoming);
      }

      next.sort(
        (left, right) =>
          getLocalHistoryTimestamp(right) - getLocalHistoryTimestamp(left),
      );
      const canonicalHistory = next.slice(0, LOCAL_ANALYSIS_HISTORY_MAX_ITEMS);
      await chrome.storage.local.set({ [storageKey]: canonicalHistory });
      return { success: true, data: { history: canonicalHistory } };
    });

  localHistoryWriteQueues.set(storageKey, operation);
  try {
    return await operation;
  } finally {
    if (localHistoryWriteQueues.get(storageKey) === operation) {
      localHistoryWriteQueues.delete(storageKey);
    }
  }
}
