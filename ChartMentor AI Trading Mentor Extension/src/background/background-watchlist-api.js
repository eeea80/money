const MENTOR_WATCHLIST_MAX_NOTE_LENGTH = 160;
const MENTOR_WATCHLIST_SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._:/!-]{0,63}$/;
const MENTOR_WATCHLIST_TIMEFRAME_PATTERN = /^([1-9]\d{0,3})(m|h|D|W|M)$/;

function normalizeMentorWatchlistSymbol(value) {
  const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
  return MENTOR_WATCHLIST_SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

function normalizeMentorWatchlistTimeframe(value) {
  if (typeof value !== "string") return null;
  const timeframe = value.trim();
  return MENTOR_WATCHLIST_TIMEFRAME_PATTERN.test(timeframe)
    ? timeframe
    : null;
}

function normalizeMentorWatchlistNote(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const note = value.trim();
  if (!note) return null;
  return note.length <= MENTOR_WATCHLIST_MAX_NOTE_LENGTH ? note : null;
}

async function getAuthenticatedWatchlistSubject() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.AUTH_TOKEN]);
  const token = stored[STORAGE_KEYS.AUTH_TOKEN];
  const subject = decodeJwtSubject(token);
  return subject ? { token, subject } : null;
}

async function mentorWatchlistApiRequest(method, body) {
  const auth = await getAuthenticatedWatchlistSubject();
  if (!auth) {
    return {
      success: false,
      error: "Sign in to sync your watchlist.",
      code: "authentication_required",
    };
  }

  const options = {
    method,
    expectedAuthSubject: auth.subject,
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  return apiRequest("/mentor-watchlist", options);
}

async function getMentorWatchlist() {
  return mentorWatchlistApiRequest("GET");
}

async function addMentorWatchlistItem(data) {
  const symbol = normalizeMentorWatchlistSymbol(data?.symbol);
  const timeframe = normalizeMentorWatchlistTimeframe(data?.timeframe);
  const rawNote = data?.note;
  const note = normalizeMentorWatchlistNote(rawNote);

  if (!symbol || !timeframe) {
    return {
      success: false,
      error: "A reliable TradingView symbol and timeframe are required.",
      code: "invalid_watchlist_item",
    };
  }
  if (
    rawNote != null &&
    String(rawNote).trim() &&
    note === null
  ) {
    return {
      success: false,
      error: `Watchlist notes must be ${MENTOR_WATCHLIST_MAX_NOTE_LENGTH} characters or fewer.`,
      code: "invalid_watchlist_note",
    };
  }

  const body = { symbol, timeframe };
  if (note) body.note = note;
  return mentorWatchlistApiRequest("POST", body);
}

async function deleteMentorWatchlistItem(data) {
  const id = typeof data?.id === "string" ? data.id.trim() : "";
  if (!id || id.length > 128) {
    return {
      success: false,
      error: "A valid watchlist item id is required.",
      code: "invalid_watchlist_id",
    };
  }
  return mentorWatchlistApiRequest("DELETE", { id });
}

async function handleMentorWatchlistAction(request) {
  if (request.type === "getMentorWatchlist") return getMentorWatchlist();
  if (request.type === "addMentorWatchlistItem") {
    return addMentorWatchlistItem(request.data);
  }
  return deleteMentorWatchlistItem(request.data);
}
