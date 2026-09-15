function getReliableCurrentWatchlistChart() {
  const symbol = normalizeWatchlistSymbol(state.currentSymbol);
  const timeframe = normalizeWatchlistTimeframe(state.currentTimeframe);
  const confidence = state.symbolConfidence;
  if (
    state.isViewingPreviousScan ||
    !symbol ||
    !timeframe ||
    (confidence !== "high" && confidence !== "medium")
  ) {
    return null;
  }
  return { symbol, timeframe };
}

function createWatchlistButton(label, action, itemId, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `watchlist-action ${className}`.trim();
  button.dataset.watchlistAction = action;
  if (itemId) button.dataset.watchlistId = itemId;
  button.textContent = label;
  button.disabled = mentorWatchlistMutationPending;
  return button;
}

function renderWatchlistStatus(container) {
  container.replaceChildren();
  if (!state.isAuthenticated) {
    const message = document.createElement("p");
    message.className = "watchlist-state-message";
    message.textContent = "Sign in to sync a watchlist across ChartMentor.";
    container.append(message);
    return;
  }
  if (mentorWatchlistLoadState === "loading") {
    const message = document.createElement("p");
    message.className = "watchlist-state-message";
    message.textContent = "Loading watchlist…";
    container.append(message);
    return;
  }
  if (mentorWatchlistLoadState === "error") {
    const message = document.createElement("p");
    message.className = "watchlist-state-message watchlist-error";
    message.textContent = mentorWatchlistError;
    container.append(
      message,
      createWatchlistButton("Retry", "retry", null, "secondary"),
    );
    return;
  }
  const count = document.createElement("p");
  count.className = "watchlist-count";
  count.textContent = `${state.mentorWatchlist.length} / ${MENTOR_WATCHLIST_LIMIT} saved`;
  container.append(count);
}

function renderWatchlistItems(container) {
  container.replaceChildren();
  if (mentorWatchlistLoadState !== "ready") return;
  if (state.mentorWatchlist.length === 0) {
    const empty = document.createElement("div");
    empty.className = "watchlist-empty";
    const title = document.createElement("strong");
    title.textContent = "No saved charts";
    const copy = document.createElement("p");
    copy.textContent = "Save the current reliable chart to return to it later.";
    empty.append(title, copy);
    container.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of state.mentorWatchlist) {
    const row = document.createElement("article");
    row.className = "watchlist-item";
    row.dataset.watchlistId = item.id;

    const details = document.createElement("div");
    details.className = "watchlist-item-details";
    const heading = document.createElement("div");
    heading.className = "watchlist-item-heading";
    const symbol = document.createElement("strong");
    symbol.textContent = item.symbol;
    const timeframe = document.createElement("span");
    timeframe.className = "watchlist-timeframe";
    timeframe.textContent = item.timeframe;
    heading.append(symbol, timeframe);
    details.append(heading);
    if (item.note) {
      const note = document.createElement("p");
      note.className = "watchlist-note";
      note.textContent = item.note;
      details.append(note);
    }

    const actions = document.createElement("div");
    actions.className = "watchlist-item-actions";
    actions.append(
      createWatchlistButton("Open chart", "open", item.id, "primary"),
      createWatchlistButton("Remove", "remove", item.id, "danger"),
    );
    row.append(details, actions);
    fragment.append(row);
  }
  container.append(fragment);
}

function renderMentorWatchlist() {
  const tab = document.getElementById("watchlist-tab");
  const status = document.getElementById("watchlist-status");
  const list = document.getElementById("watchlist-list");
  const chartLabel = document.getElementById("watchlist-current-chart");
  const addButton = document.getElementById("watchlist-add-current");
  const noteInput = document.getElementById("watchlist-note-input");
  if (!tab || !status || !list || !chartLabel || !addButton || !noteInput) {
    return;
  }

  const currentChart = getReliableCurrentWatchlistChart();
  chartLabel.textContent = currentChart
    ? `${currentChart.symbol} · ${currentChart.timeframe}`
    : "Waiting for a reliable chart…";
  const isFull = state.mentorWatchlist.length >= MENTOR_WATCHLIST_LIMIT;
  addButton.disabled = Boolean(
    !state.isAuthenticated ||
      !currentChart ||
      isFull ||
      mentorWatchlistMutationPending,
  );
  addButton.textContent = isFull ? "Watchlist full" : "Add current chart";
  noteInput.disabled = !state.isAuthenticated || mentorWatchlistMutationPending;
  renderWatchlistStatus(status);
  renderWatchlistItems(list);
}
