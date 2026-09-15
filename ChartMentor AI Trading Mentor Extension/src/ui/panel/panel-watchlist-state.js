const MENTOR_WATCHLIST_LIMIT = 20;
const MENTOR_WATCHLIST_NOTE_LIMIT = 160;
const MENTOR_WATCHLIST_SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._:/!-]{0,63}$/;
const MENTOR_WATCHLIST_TIMEFRAME_PATTERN = /^([1-9]\d{0,3})(m|h|D|W|M)$/;

let mentorWatchlistLoadState = "loading";
let mentorWatchlistError = "";
let mentorWatchlistMutationPending = false;

function normalizeWatchlistSymbol(value) {
  const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
  return MENTOR_WATCHLIST_SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

function normalizeWatchlistTimeframe(value) {
  if (typeof value !== "string") return null;
  const timeframe = value.trim();
  return MENTOR_WATCHLIST_TIMEFRAME_PATTERN.test(timeframe)
    ? timeframe
    : null;
}

function normalizeMentorWatchlistItem(rawItem) {
  if (!rawItem || typeof rawItem !== "object") return null;
  const id = typeof rawItem.id === "string" ? rawItem.id.trim() : "";
  const userId =
    typeof rawItem.user_id === "string" ? rawItem.user_id.trim() : "";
  const symbol = normalizeWatchlistSymbol(rawItem.symbol);
  const timeframe = normalizeWatchlistTimeframe(rawItem.timeframe);
  const note = rawItem.note == null ? null : String(rawItem.note).trim();

  if (
    !id ||
    id.length > 128 ||
    !userId ||
    !symbol ||
    !timeframe ||
    (note && note.length > MENTOR_WATCHLIST_NOTE_LIMIT)
  ) {
    return null;
  }

  return {
    id,
    user_id: userId,
    symbol,
    timeframe,
    note: note || null,
    created_at:
      typeof rawItem.created_at === "string" ? rawItem.created_at : null,
    updated_at:
      typeof rawItem.updated_at === "string" ? rawItem.updated_at : null,
  };
}

function normalizeMentorWatchlistItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const seenIds = new Set();
  const items = [];
  for (const rawItem of rawItems) {
    const item = normalizeMentorWatchlistItem(rawItem);
    if (!item || seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    items.push(item);
    if (items.length === MENTOR_WATCHLIST_LIMIT) break;
  }
  return items;
}

function renderMentorWatchlistIfReady() {
  if (typeof renderMentorWatchlist === "function") renderMentorWatchlist();
}

function hydrateMentorWatchlist(rawItems) {
  state.mentorWatchlist = normalizeMentorWatchlistItems(rawItems);
  mentorWatchlistLoadState = "ready";
  mentorWatchlistError = "";
  renderMentorWatchlistIfReady();
  return state.mentorWatchlist;
}

function setMentorWatchlistLoading() {
  mentorWatchlistLoadState = "loading";
  mentorWatchlistError = "";
  renderMentorWatchlistIfReady();
}

function setMentorWatchlistError(message) {
  mentorWatchlistLoadState = "error";
  mentorWatchlistError =
    typeof message === "string" && message.trim()
      ? message.trim()
      : "Watchlist sync failed. Try again.";
  renderMentorWatchlistIfReady();
}

function setMentorWatchlistMutationPending(pending) {
  mentorWatchlistMutationPending = pending === true;
  renderMentorWatchlistIfReady();
}

function prependMentorWatchlistItem(rawItem) {
  const item = normalizeMentorWatchlistItem(rawItem);
  if (!item) return false;
  state.mentorWatchlist = [
    item,
    ...state.mentorWatchlist.filter((existing) => existing.id !== item.id),
  ].slice(0, MENTOR_WATCHLIST_LIMIT);
  mentorWatchlistLoadState = "ready";
  mentorWatchlistError = "";
  renderMentorWatchlistIfReady();
  return true;
}

function removeMentorWatchlistItemFromState(id) {
  const nextItems = state.mentorWatchlist.filter((item) => item.id !== id);
  if (nextItems.length === state.mentorWatchlist.length) return false;
  state.mentorWatchlist = nextItems;
  mentorWatchlistLoadState = "ready";
  mentorWatchlistError = "";
  renderMentorWatchlistIfReady();
  return true;
}

function resetMentorWatchlistState() {
  state.mentorWatchlist = [];
  mentorWatchlistLoadState = state.isAuthenticated ? "loading" : "ready";
  mentorWatchlistError = "";
  mentorWatchlistMutationPending = false;
  renderMentorWatchlistIfReady();
}
