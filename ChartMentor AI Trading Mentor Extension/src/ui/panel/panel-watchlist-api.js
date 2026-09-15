async function sendMentorWatchlistAction(type, data) {
  try {
    const response = await chrome.runtime.sendMessage({ type, data });
    if (!response || response.success !== true) {
      return {
        success: false,
        error: response?.error || "Watchlist sync failed. Try again.",
      };
    }
    return response;
  } catch (_error) {
    return {
      success: false,
      error: "Watchlist sync failed. Check your connection and try again.",
    };
  }
}

async function loadMentorWatchlist({ showLoading = true } = {}) {
  if (!state.isAuthenticated) {
    resetMentorWatchlistState();
    return false;
  }
  if (showLoading) setMentorWatchlistLoading();

  // The auth token can rotate to a different account while this request is
  // in flight (e.g. the user signs out/in from the History tab). Bind the
  // response to whichever account initiated the request and drop it if the
  // active account has since changed, instead of hydrating one account's
  // private watchlist items/notes into another account's panel.
  const requestAuthToken = await ChartMentorStorage.getAuthToken();
  const requestSubject = getHistoryOwnerSubjectFromToken(requestAuthToken);

  const response = await sendMentorWatchlistAction("getMentorWatchlist");

  const currentAuthToken = await ChartMentorStorage.getAuthToken();
  const currentSubject = getHistoryOwnerSubjectFromToken(currentAuthToken);
  if (currentSubject !== requestSubject) {
    console.log(
      "ChartMentor: Ignoring watchlist response from a previous account.",
    );
    return false;
  }

  if (!response.success || !Array.isArray(response.data?.items)) {
    return false;
  }

  hydrateMentorWatchlist(response.data.items);
  return true;
}

async function createMentorWatchlistItem({ symbol, timeframe, note }) {
  if (mentorWatchlistMutationPending) return false;
  if (state.mentorWatchlist.length >= MENTOR_WATCHLIST_LIMIT) {
    setMentorWatchlistError(
      `Your watchlist is full (${MENTOR_WATCHLIST_LIMIT} charts).`,
    );
    return false;
  }

  const normalizedSymbol = normalizeWatchlistSymbol(symbol);
  const normalizedTimeframe = normalizeWatchlistTimeframe(timeframe);
  const normalizedNote = typeof note === "string" ? note.trim() : "";
  if (!normalizedSymbol || !normalizedTimeframe) {
    setMentorWatchlistError(
      "Wait for a reliable TradingView symbol and timeframe before adding.",
    );
    return false;
  }
  if (normalizedNote.length > MENTOR_WATCHLIST_NOTE_LIMIT) {
    setMentorWatchlistError(
      `Notes must be ${MENTOR_WATCHLIST_NOTE_LIMIT} characters or fewer.`,
    );
    return false;
  }

  setMentorWatchlistMutationPending(true);
  const data = { symbol: normalizedSymbol, timeframe: normalizedTimeframe };
  if (normalizedNote) data.note = normalizedNote;
  const response = await sendMentorWatchlistAction(
    "addMentorWatchlistItem",
    data,
  );
  setMentorWatchlistMutationPending(false);

  if (!response.success || !response.data?.item) {
    setMentorWatchlistError(response.error);
    return false;
  }
  if (!prependMentorWatchlistItem(response.data.item)) {
    setMentorWatchlistError("The server returned an invalid watchlist item.");
    return false;
  }
  return true;
}

async function deleteMentorWatchlistItemById(id) {
  if (mentorWatchlistMutationPending) return false;
  const itemId = typeof id === "string" ? id.trim() : "";
  if (!itemId) return false;

  setMentorWatchlistMutationPending(true);
  const response = await sendMentorWatchlistAction(
    "deleteMentorWatchlistItem",
    { id: itemId },
  );
  setMentorWatchlistMutationPending(false);

  if (
    !response.success ||
    response.data?.success !== true ||
    response.data?.id !== itemId
  ) {
    setMentorWatchlistError(response.error);
    return false;
  }
  return removeMentorWatchlistItemFromState(itemId);
}
